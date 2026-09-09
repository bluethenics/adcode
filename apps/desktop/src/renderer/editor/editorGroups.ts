/** Visible file assignments only. Buffers outlive groups and belong to EditorHost. */
export class EditorGroups {
  paths: [string | null, string | null] = [null, null];
  active: 0 | 1 = 0;
  isSplit = false;

  open(path: string): void { this.paths[this.active] = path; }

  focus(group: 0 | 1): void {
    if (group === 0 || this.isSplit) this.active = group;
  }

  split(path: string): void {
    this.isSplit = true;
    this.active = 1;
    this.paths[1] = path;
  }

  collapse(): void {
    this.paths = [this.paths[this.active] ?? this.paths[0] ?? this.paths[1], null];
    this.active = 0;
    this.isSplit = false;
  }

  close(path: string): void {
    if (!this.paths.includes(path)) return;
    this.paths = this.paths.map((value) => value === path ? null : value) as typeof this.paths;
    this.collapse();
  }

  rename(before: string, after: string): void {
    this.paths = this.paths.map((value) => value === before ? after : value) as typeof this.paths;
  }
}
