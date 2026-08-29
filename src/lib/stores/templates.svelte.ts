import { getTemplates, setTemplates } from '$lib/core/db/kv';
import { newTemplate, type Template } from '$lib/core/templates/template';

/**
 * The writer's templates.
 *
 * Held in IndexedDB alongside settings, not in the repository. That is a real
 * limitation — a second device starts with the starters rather than with yours
 * — and the settings sheet says so, but committing them would mean teaching the
 * sync engine a second kind of file, with its own merge rules, on top of the
 * day-file path everything else depends on.
 */
class TemplateStore {
	all = $state<Template[]>([]);
	loaded = $state(false);

	async load(): Promise<void> {
		this.all = await getTemplates();
		this.loaded = true;
	}

	byId(id: string | null): Template | undefined {
		if (id === null) return undefined;

		return this.all.find((template) => template.id === id);
	}

	/** Returns the new template so the caller can put the cursor in its name. */
	async add(): Promise<Template> {
		const template = newTemplate('Untitled', '');
		this.all = [...this.all, template];
		await this.#persist();

		return template;
	}

	async update(id: string, patch: Partial<Omit<Template, 'id'>>): Promise<void> {
		this.all = this.all.map((template) =>
			template.id === id ? { ...template, ...patch } : template
		);
		await this.#persist();
	}

	async remove(id: string): Promise<void> {
		this.all = this.all.filter((template) => template.id !== id);
		await this.#persist();
	}

	async #persist(): Promise<void> {
		await setTemplates(this.all);
	}
}

export const templates = new TemplateStore();
