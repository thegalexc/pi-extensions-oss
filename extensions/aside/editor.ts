import { Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

export interface AsideEditor {
	focused: boolean;
	onChange?: (text: string) => void;
	onSubmit?: (...args: any[]) => void;
	handleInput(data: string): void;
	setText(text: string): void;
	getExpandedText(): string;
	render(width: number): string[];
	invalidate(): void;
}

export function createAsideEditor(tui: TUI, theme: EditorTheme): AsideEditor {
	return new Editor(tui, theme, { paddingX: 1 });
}

export function initializeAsideEditor(input: {
	editor: AsideEditor;
	initialDraft: string;
	onDraftChange: (text: string) => void;
	onSubmit: (text: string) => void;
}): AsideEditor {
	input.editor.onChange = (text) => {
		input.onDraftChange(text);
	};
	input.editor.onSubmit = (text) => {
		input.onSubmit(text);
	};
	input.editor.setText(input.initialDraft);
	return input.editor;
}

export function resolveAsidePreviewPrompt(editor: Pick<AsideEditor, "getExpandedText"> | undefined, draftText: string): string {
	return editor?.getExpandedText() ?? draftText;
}
