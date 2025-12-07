import { execSync } from 'child_process';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

export interface DockerComposeOptions {
  projectName?: string;
  configFile?: string;
  dockerPath?: string;
}

/**
 * Docker Compose utility for managing test containers
 */
export class DockerCompose {
  private dockerPath: string;
  private composeFile: string;
  private projectName: string;

  constructor(options: DockerComposeOptions = {}) {
    this.dockerPath = options.dockerPath || '/usr/local/bin/docker';
    this.composeFile = options.configFile || 'docker-compose.test.yml';
    this.projectName = options.projectName || 'kysera-test';
  }

  /**
   * Check if Docker is available
   */
  isAvailable(): boolean {
    try {
      execSync(`${this.dockerPath} --version`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start containers
   */
  async up(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Docker is not available at ' + this.dockerPath);
    }

    const cmd = `${this.dockerPath} compose -f ${this.composeFile} -p ${this.projectName} up -d`;
    execSync(cmd, { stdio: 'inherit' });

    // Wait for containers to be healthy
    await this.waitForHealthy();
  }

  /**
   * Stop containers
   */
  async down(): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }

    const cmd = `${this.dockerPath} compose -f ${this.composeFile} -p ${this.projectName} down -v`;
    execSync(cmd, { stdio: 'ignore' });
  }

  /**
   * Wait for all containers to be healthy
   */
  private async waitForHealthy(maxRetries = 30): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const status = this.getContainerStatus();
        if (status.every((s) => s.includes('healthy'))) {
          return;
        }
      } catch {
        // Ignore errors during startup
      }
      await sleep(1000);
    }
    throw new Error('Containers failed to become healthy');
  }

  /**
   * Get container status
   */
  private getContainerStatus(): string[] {
    const cmd = `${this.dockerPath} compose -f ${this.composeFile} -p ${this.projectName} ps --format json`;
    const output = execSync(cmd, { encoding: 'utf8' });
    const lines = output.trim().split('\n').filter(Boolean);

    return lines.map((line) => {
      try {
        const container = JSON.parse(line);
        return container.Health || container.Status || 'unknown';
      } catch {
        return 'unknown';
      }
    });
  }

  /**
   * Execute command in container
   */
  exec(service: string, command: string): string {
    const cmd = `${this.dockerPath} compose -f ${this.composeFile} -p ${this.projectName} exec -T ${service} ${command}`;
    return execSync(cmd, { encoding: 'utf8' });
  }

  /**
   * Get container logs
   */
  logs(service?: string): string {
    const serviceArg = service ? service : '';
    const cmd = `${this.dockerPath} compose -f ${this.composeFile} -p ${this.projectName} logs ${serviceArg}`;
    return execSync(cmd, { encoding: 'utf8' });
  }

  /**
   * Restart a service
   */
  async restart(service: string): Promise<void> {
    const cmd = `${this.dockerPath} compose -f ${this.composeFile} -p ${this.projectName} restart ${service}`;
    execSync(cmd, { stdio: 'ignore' });
    await sleep(2000); // Wait for service to restart
  }
}
