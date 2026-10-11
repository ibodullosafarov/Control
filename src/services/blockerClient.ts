import { BlockingStrategy, BlockerStatus, AppBlockerStatus } from '../types';

class BlockerClient {
  private currentStatus: BlockerStatus = {
    isActive: false,
    strategy: 'dynamic_hosts',
    blockedCount: 0,
    blockedDomains: [],
    selfControlAvailable: true,
    hostsManageable: true,
  };

  private currentAppStatus: AppBlockerStatus = {
    isActive: false,
    blockedApps: [],
    blockedCount: 0,
  };

  async startAppBlocking(apps: string[]): Promise<{ success: boolean; error?: string }> {
    if (window.focusAPI) {
      try {
        const res = await window.focusAPI.startAppBlocking(apps);
        await this.refreshAppStatus();
        return res;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    }

    this.currentAppStatus = {
      ...this.currentAppStatus,
      isActive: true,
      blockedApps: apps,
      blockedCount: apps.length,
    };
    return { success: true };
  }

  async stopAppBlocking(): Promise<{ success: boolean; error?: string }> {
    if (window.focusAPI) {
      try {
        const res = await window.focusAPI.stopAppBlocking();
        await this.refreshAppStatus();
        return res;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    }

    this.currentAppStatus = {
      isActive: false,
      blockedApps: [],
      blockedCount: 0,
    };
    return { success: true };
  }

  async refreshAppStatus(): Promise<AppBlockerStatus> {
    if (window.focusAPI) {
      try {
        this.currentAppStatus = await window.focusAPI.getAppBlockerStatus();
      } catch (err) {
        console.warn('Failed to get app blocker status:', err);
      }
    }
    return this.currentAppStatus;
  }

  getAppStatus(): AppBlockerStatus {
    return this.currentAppStatus;
  }

  async startBlocking(domains: string[], strategy: BlockingStrategy = 'dynamic_hosts'): Promise<{ success: boolean; error?: string }> {
    if (strategy === 'none' || domains.length === 0) {
      return { success: true };
    }

    if (window.focusAPI) {
      try {
        const res = await window.focusAPI.startBlocking(domains, strategy);
        await this.refreshStatus();
        return res;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    }

    // Web fallback simulation
    this.currentStatus = {
      ...this.currentStatus,
      isActive: true,
      strategy,
      blockedCount: domains.length,
      blockedDomains: domains,
    };
    return { success: true };
  }

  async stopBlocking(): Promise<{ success: boolean; error?: string }> {
    if (window.focusAPI) {
      try {
        const res = await window.focusAPI.stopBlocking();
        await this.refreshStatus();
        return res;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    }

    this.currentStatus = {
      ...this.currentStatus,
      isActive: false,
      blockedCount: 0,
      blockedDomains: [],
    };
    return { success: true };
  }

  async refreshStatus(): Promise<BlockerStatus> {
    if (window.focusAPI) {
      try {
        this.currentStatus = await window.focusAPI.getBlockerStatus();
      } catch (err) {
        console.warn('Failed to get blocker status:', err);
      }
    }
    return this.currentStatus;
  }

  getStatus(): BlockerStatus {
    return this.currentStatus;
  }
}

export const blockerClient = new BlockerClient();
