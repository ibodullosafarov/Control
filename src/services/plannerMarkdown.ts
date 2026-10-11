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
    if (window.focusAPI?.plannerMdStatus) {
      return await window.focusAPI.plannerMdStatus(this.vaultPath);
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
    if (window.focusAPI?.plannerMdListTemplates) {
      return await window.focusAPI.plannerMdListTemplates(this.vaultPath);
    }
    return [];
  }

  async readDay(date: string): Promise<DayMarkdownPlan | null> {
    if (window.focusAPI?.plannerMdReadDay) {
      return await window.focusAPI.plannerMdReadDay(this.vaultPath, date);
    }
    return null;
  }

  async applyTemplate(
    templateName: string,
    date: string,
    variables: Record<string, string>
  ): Promise<ApplyTemplateResult> {
    if (window.focusAPI?.plannerMdApplyTemplate) {
      return await window.focusAPI.plannerMdApplyTemplate(
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
    if (window.focusAPI?.plannerMdCreateTemplate) {
      return await window.focusAPI.plannerMdCreateTemplate(this.vaultPath, name, content);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async saveDayAsTemplate(
    date: string,
    name: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> {
    if (window.focusAPI?.plannerMdSaveDayAsTemplate) {
      return await window.focusAPI.plannerMdSaveDayAsTemplate(this.vaultPath, date, name);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async duplicateTemplate(
    name: string,
    newName: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> {
    if (window.focusAPI?.plannerMdDuplicateTemplate) {
      return await window.focusAPI.plannerMdDuplicateTemplate(this.vaultPath, name, newName);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async deleteTemplate(name: string): Promise<PlannerMdOpResult> {
    if (window.focusAPI?.plannerMdDeleteTemplate) {
      return await window.focusAPI.plannerMdDeleteTemplate(this.vaultPath, name);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  /** Create or overwrite a template file with verbatim editor content. */
  async writeTemplate(
    name: string,
    content: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> {
    if (window.focusAPI?.plannerMdWriteTemplate) {
      return await window.focusAPI.plannerMdWriteTemplate(this.vaultPath, name, content);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async toggleTask(
    date: string,
    taskIndex: number,
    completed: boolean
  ): Promise<PlannerMdTaskOpResult> {
    if (window.focusAPI?.plannerMdToggleTask) {
      return await window.focusAPI.plannerMdToggleTask(this.vaultPath, date, taskIndex, completed);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async updateTaskTitle(
    date: string,
    taskIndex: number,
    title: string
  ): Promise<PlannerMdTaskOpResult> {
    if (window.focusAPI?.plannerMdUpdateTaskTitle) {
      return await window.focusAPI.plannerMdUpdateTaskTitle(
        this.vaultPath,
        date,
        taskIndex,
        title
      );
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  async openFile(filePath: string): Promise<PlannerMdOpResult> {
    if (window.focusAPI?.plannerMdOpenFile) {
      return await window.focusAPI.plannerMdOpenFile(filePath);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  /** Raw template Markdown for renderer-side schedule parsing/generation. */
  async readTemplate(templateName: string): Promise<PlannerMdOpResult & { content?: string }> {
    if (window.focusAPI?.plannerMdReadTemplate) {
      return await window.focusAPI.plannerMdReadTemplate(this.vaultPath, templateName);
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
    if (window.focusAPI?.plannerMdUpdateDaySchedule) {
      return await window.focusAPI.plannerMdUpdateDaySchedule(this.vaultPath, date, sectionBody);
    }
    return { success: false, error: 'Electron API is not available in browser mode.' };
  }

  onFileChanged(callback: (payload: PlannerFileChangeEvent) => void): () => void {
    if (window.focusAPI?.onPlannerFileChanged) {
      return window.focusAPI.onPlannerFileChanged(callback);
    }
    return () => {};
  }
}

export const plannerMd = new PlannerMarkdownService();
