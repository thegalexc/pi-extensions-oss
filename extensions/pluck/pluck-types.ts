export const PLUCK_CUSTOM_TYPE = "pluck";
export const MAX_SELECTED_CHUNKS = 5;
export const TARGET_CHARS_PER_CHUNK = 1200;
export const HARD_CHARS_PER_CHUNK = 1600;
export const MAX_TOTAL_IMPORT_CHARS = 5000;

export type SessionChunkType =
	| "branch_summary"
	| "compaction_summary"
	| "label_checkpoint"
	| "user_goal"
	| "assistant_plan"
	| "assistant_conclusion"
	| "tool_finding";

export type SessionChunk = {
	id: string;
	sourceEntryId: string;
	type: SessionChunkType;
	title: string;
	preview: string;
	fullText: string;
	timestamp: number;
	score: number;
	tags: string[];
};

export type PluckMetadata = {
	sessionId: string;
	sessionPath: string;
	cwd: string;
	name?: string;
	modifiedAt?: Date;
	query?: string;
	crossCwd: boolean;
};

export type ParsedPluckArgs = {
	sessionId: string;
	query?: string;
};

export type FormattedImport = {
	content: string;
	usedChunks: Array<SessionChunk & { importedText: string }>;
	truncated: boolean;
	tooLarge: boolean;
};
