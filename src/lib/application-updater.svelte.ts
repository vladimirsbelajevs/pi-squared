export const applicationUpdateState = $state({ busy: false });

export const applicationUpdateEnvironment = {
	reload(): void {
		window.location.reload();
	}
};

type ApplicationUpdateStarter = () => void;

let starter: ApplicationUpdateStarter | undefined;

export function registerApplicationUpdateStarter(next: ApplicationUpdateStarter): () => void {
	starter = next;

	return () => {
		if (starter === next) {
			starter = undefined;
		}
	};
}

export function requestApplicationUpdate(): boolean {
	if (!starter) {
		return false;
	}

	starter();

	return true;
}
