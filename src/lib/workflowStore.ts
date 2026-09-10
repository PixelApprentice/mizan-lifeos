import { deleteSetting, listSettings, setSetting } from "./api";
import { parseNoteTemplate, parseSavedView, type NoteTemplate, type SavedTaskView } from "./workflows";

function key(prefix: string, id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid workflow identifier.");
  return `${prefix}:${id}`;
}
export async function listNoteTemplates(): Promise<NoteTemplate[]> {
  return (await listSettings("templates:")).map(({ key, value }) => parseNoteTemplate(value, key.slice("templates:".length)));
}
export async function saveNoteTemplate(template: NoteTemplate): Promise<void> {
  const checked = parseNoteTemplate(JSON.stringify(template), template.id);
  await setSetting(key("templates", template.id), JSON.stringify(checked));
}
export const deleteNoteTemplate = (id: string) => deleteSetting(key("templates", id));
export async function listTaskViews(): Promise<SavedTaskView[]> {
  return (await listSettings("taskviews:")).map(({ key, value }) => parseSavedView(value, key.slice("taskviews:".length)));
}
export async function saveTaskView(view: SavedTaskView): Promise<void> {
  const checked = parseSavedView(JSON.stringify(view), view.id);
  await setSetting(key("taskviews", view.id), JSON.stringify(checked));
}
export const deleteTaskView = (id: string) => deleteSetting(key("taskviews", id));
