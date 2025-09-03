import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import {
	generateCertificatePDF,
	createCertificateZip,
	generateCertificateThumbnail,
} from './src/certificate-renderer.js';
import type { RenderPayload, RenderResult, BatchRenderResult, Certificate } from './src/types.js';

const api = new Hono();

api.use(
	cors({
		origin: ['http://localhost:8000', 'https://easy-cert-api.sunthewhat.com'],
	})
)
	.use(logger())
	.use(
		'/file/*',
		serveStatic({
			root: './public',
			rewriteRequestPath: (path) => path.replace(/^\/file/, ''),
		})
	)
	.basePath('api')
	.get('health', (c) => {
		return c.text('easy cert renderer module!');
	})
	.post('render', async (c) => {
		try {
			const body = await c.req.json<RenderPayload>();
			const { certificate, participants } = body;

			const results: RenderResult[] = [];
			const successfulPdfPaths: string[] = [];

			for (const participant of participants) {
				if (!participant.is_revoked) {
					try {
						const filePath = await generateCertificatePDF(certificate, participant);
						results.push({
							participantId: participant.id,
							filePath: filePath,
							status: 'success',
						});
						successfulPdfPaths.push(filePath);
					} catch (error) {
						results.push({
							participantId: participant.id,
							filePath: null,
							status: 'error',
							error: error instanceof Error ? error.message : 'Unknown error',
						});
					}
				} else {
					results.push({
						participantId: participant.id,
						filePath: null,
						status: 'skipped_revoked',
					});
				}
			}

			const response: BatchRenderResult = {
				message: 'Certificate generation completed',
				results: results,
			};

			// Create zip file if there are successful PDFs
			if (successfulPdfPaths.length > 0) {
				try {
					const zipFilePath = await createCertificateZip(certificate, successfulPdfPaths);
					response.zipFilePath = zipFilePath;
				} catch (error) {
					console.error('Error creating zip file:', error);
				}
			}

			return c.json(response);
		} catch (error) {
			console.error('Error processing request:', error);
			return c.json(
				{
					error: 'Failed to process request',
					details: error instanceof Error ? error.message : 'Unknown error',
				},
				500
			);
		}
	})
	.post('thumbnail', async (c) => {
		try {
			const body = await c.req.json<{
				certificate: Certificate;
				width?: number;
				height?: number;
			}>();
			const { certificate, width, height } = body;

			if (!certificate) {
				return c.json({ error: 'Certificate data is required' }, 400);
			}

			const thumbnailPath = await generateCertificateThumbnail(
				certificate,
				width || 300,
				height || 225
			);

			return c.json({
				message: 'Thumbnail generated successfully',
				thumbnailPath: thumbnailPath,
			});
		} catch (error) {
			console.error('Error generating thumbnail:', error);
			return c.json(
				{
					error: 'Failed to generate thumbnail',
					details: error instanceof Error ? error.message : 'Unknown error',
				},
				500
			);
		}
	});

export default {
	fetch: api.fetch,
	port: 9000,
};
