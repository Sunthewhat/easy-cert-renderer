export type Certificate = {
	id: string;
	name: string;
	design: string;
	user_id: string;
};

export type Participant = {
	id: string;
	certificate_id: string;
	is_revoked: boolean;
	data: Record<string, any>;
};

export type RenderPayload = {
	certificate: Certificate;
	participants: Participant[];
};

export type RenderResult = {
	participantId: string;
	filePath: string | null;
	status: 'success' | 'skipped_revoked' | 'error';
	error?: string;
};

export type BatchRenderResult = {
	message: string;
	results: RenderResult[];
	zipFilePath?: string;
};
