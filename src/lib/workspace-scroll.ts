import { createContext } from 'svelte';

export interface WorkspaceScrollController {
	captureScrollBeforeContentChange(key: string): void;
}

export const [getWorkspaceScrollController, setWorkspaceScrollController] =
	createContext<WorkspaceScrollController>();
