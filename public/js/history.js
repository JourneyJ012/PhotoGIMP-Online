// Undo history. Entries are {label, undo(), redo()}; entries[0] is the base
// state ("New Document", "Open") and cannot be undone.

export class History {
  constructor(doc, baseLabel) {
    this.doc = doc;
    this.entries = [{ label: baseLabel, base: true }];
    this.index = 0;
    this.groups = [];
    this.limit = 60;
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  get undoLabel() { return this.canUndo ? this.entries[this.index].label : ''; }
  get redoLabel() { return this.canRedo ? this.entries[this.index + 1].label : ''; }

  push(entry) {
    if (this.groups.length) { this.groups.at(-1).items.push(entry); return; }
    if (this.doc.savedIndex > this.index) this.doc.savedIndex = -1; // saved state discarded
    this.entries.length = this.index + 1;
    this.entries.push(entry);
    this.index++;
    while (this.entries.length > this.limit + 1) {
      this.entries.shift();
      this.entries[0].base = true;
      this.index--;
      this.doc.savedIndex--;
    }
    this.doc.notify();
  }

  /** Collect every entry pushed until end() into one entry. Groups nest. */
  begin(label) { this.groups.push({ label, items: [] }); }

  end() {
    const g = this.groups.pop();
    if (!g || !g.items.length) return;
    const items = g.items;
    this.push(items.length === 1 ? { ...items[0], label: g.label || items[0].label } : {
      label: g.label,
      undo() { for (let i = items.length - 1; i >= 0; i--) items[i].undo(); },
      redo() { for (const it of items) it.redo(); },
    });
  }

  undo() {
    if (!this.canUndo) return false;
    this.entries[this.index].undo();
    this.index--;
    this.doc.notify();
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.index++;
    this.entries[this.index].redo();
    this.doc.notify();
    return true;
  }

  jump(i) {
    while (this.index > i && this.undo());
    while (this.index < i && this.redo());
  }
}
