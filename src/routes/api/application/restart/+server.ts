import { json, type RequestHandler } from '@sveltejs/kit';
import {
	claimApplicationRestart,
	getSupportedApplicationPlatform,
	invokeApplicationRestart,
	queryNativeRegistration,
	releaseApplicationUpdate,
	scheduleApplicationManagementRelease
} from '$lib/server/application-update';
import { errorResponse, isSameOriginRequest } from '$lib/server/http';

export const POST: RequestHandler = async ({ request, url }) => {
	if (!isSameOriginRequest(request, url.origin)) {
		return json(
			{ error: 'Application restart requests must originate from this local application.' },
			{ status: 403 }
		);
	}

	const platform = getSupportedApplicationPlatform();
	if (!platform) {
		return json(
			{ error: 'Application restart is not supported on this platform.' },
			{ status: 501 }
		);
	}

	if (!claimApplicationRestart()) {
		return json(
			{ error: 'Wait for the application update to finish before restarting.' },
			{ status: 409 }
		);
	}

	try {
		if (!(await queryNativeRegistration(platform))) {
			releaseApplicationUpdate();

			return json(
				{
					error:
						'No native background registration was found. Rerun setup with background registration enabled.'
				},
				{ status: 409 }
			);
		}

		await invokeApplicationRestart();
		scheduleApplicationManagementRelease();

		return json({ accepted: true });
	} catch (error) {
		releaseApplicationUpdate();

		return errorResponse(error, 500);
	}
};
