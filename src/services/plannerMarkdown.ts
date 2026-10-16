import {
  ApplyTemplateResult,
  DayMarkdownPlan,
  PlannerFileChangeEvent,
  PlannerMdOpResult,
  PlannerMdStatus,
  PlannerMdTaskOpResult,
  PlannerTemplate,
} from '../types';

/**
 * Thin renderer-side client for the Markdown Day Planner.
 * All file I/O happens in the Electron main process; Obsidian owns the files.
 */
class PlannerMarkdownService {
  private vaultPath = '';

  /** Set by the app on boot / settings change so callers stay terse. */
  setVaultPath(vaultPath: string) {
    this.vaultPath = vaultPath || '';
  }

  getVaultPath(): string {
    return this.vaultPath;
  }

  async getStatus(): Promise<PlannerMdStatus> {
    if (window.controlAPI?.plannerMdStatus) {
      return await window.controlAPI.plannerMdStatus(this.vaultPath);
    }
    return {
      enabled: false,
      rootPath: '',
      daysDir: '',
      templatesDir: '',
      error: 'Electron API is not available in browser mode.',
    };
  }

  async listTemplates(): Promise<PlannerTemplate[]> {
    if (window.controlAPI?.plannerMdListTemplates) {
      return await window.controlAPI.plannerMdListTemplates(this.vaultPath);
    }
    return [];
  }

  async readDay(date: string): Promise<DayMarkdownPlan | null> {
    if (window.controlAPI?.plannerMdReadDay) {
      return await window.controlAPI.plannerMdReadDay(this.vaultPath, date);
    }
    return null;
  }

  async applyTemplate(
    templateName: string,
    date: string,
    variables: Record<string, string>
  ): Promise<ApplyTemplateResult> {
    if (window.controlAPI?.plannerMdApplyTemplate) {
      return await window.controlAPI.plannerMdApplyTemplate(
        this.vaultPath,
        templateName,
        date,
        variables
      );
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async createTemplate(
    name: string,
    content: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> {
    if (window.controlAPI?.plannerMdCreateTemplate) {
      return await window.controlAPI.plannerMdCreateTemplate(this.vaultPath, name, content);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async saveDayAsTemplate(
    date: string,
    name: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> {
    if (window.controlAPI?.plannerMdSaveDayAsTemplate) {
      return await window.controlAPI.plannerMdSaveDayAsTemplate(this.vaultPath, date, name);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async duplicateTemplate(
    name: string,
    newName: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> {
    if (window.controlAPI?.plannerMdDuplicateTemplate) {
      return await window.controlAPI.plannerMdDuplicateTemplate(this.vaultPath, name, newName);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async deleteTemplate(name: string): Promise<PlannerMdOpResult> {
    if (window.controlAPI?.plannerMdDeleteTemplate) {
      return await window.controlAPI.plannerMdDeleteTemplate(this.vaultPath, name);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  /** Create or overwrite a template file with verbatim editor content. */
  async writeTemplate(
    name: string,
    content: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> {
    if (window.controlAPI?.plannerMdWriteTemplate) {
      return await window.controlAPI.plannerMdWriteTemplate(this.vaultPath, name, content);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async toggleTask(
    date: string,
    taskIndex: number,
    completed: boolean
  ): Promise<PlannerMdTaskOpResult> {
    if (window.controlAPI?.plannerMdToggleTask) {
      return await window.controlAPI.plannerMdToggleTask(this.vaultPath, date, taskIndex, completed);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async updateTaskTitle(
    date: string,
    taskIndex: number,
    title: string
  ): Promise<PlannerMdTaskOpResult> {
    if (window.controlAPI?.plannerMdUpdateTaskTitle) {
      return await window.controlAPI.plannerMdUpdateTaskTitle(
        this.vaultPath,
        date,
        taskIndex,
        title
      );
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async openFile(filePath: string): Promise<PlannerMdOpResult> {
    if (window.controlAPI?.plannerMdOpenFile) {
      return await window.controlAPI.plannerMdOpenFile(filePath);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  /** Raw template Markdown for renderer-side schedule parsing/generation. */
  async readTemplate(templateName: string): Promise<PlannerMdOpResult & { content?: string }> {
    if (window.controlAPI?.plannerMdReadTemplate) {
      return await window.controlAPI.plannerMdReadTemplate(this.vaultPath, templateName);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  /**
   * Record a generated schedule in the day note. Only the
   * `## Generated Schedule` section is touched; everything else is preserved.
   */
  async updateDaySchedule(
    date: string,
    sectionBody: string
  ): Promise<PlannerMdOpResult & { path?: string }> {
    if (window.controlAPI?.plannerMdUpdateDaySchedule) {
      return await window.controlAPI.plannerMdUpdateDaySchedule(this.vaultPath, date, sectionBody);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  onFileChanged(callback: (payload: PlannerFileChangeEvent) => void): () => void {
    if (window.controlAPI?.onPlannerFileChanged) {
      return window.controlAPI.onPlannerFileChanged(callback);
    }
    return () => {};
  }
}

export const plannerMd = new PlannerMarkdownService();
