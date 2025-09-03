import { fabric } from 'fabric';
import jsPDF from 'jspdf';
import archiver from 'archiver';
import type { Certificate, Participant } from './types.js';
import { uploadToMinio, downloadFromMinio } from './minio-storage.js';

export function replacePlaceholders(
	canvasJson: string,
	participantData: Record<string, any>
): string {
	const canvasData = JSON.parse(canvasJson);

	if (canvasData.objects) {
		canvasData.objects.forEach((obj: any, index: number) => {
			if (obj.id && obj.id.includes('PLACEHOLDER-')) {
				console.log(`Found placeholder object at index ${index}:`, {
					type: obj.type,
					text: obj.text,
					id: obj.id,
				});

				const fieldName = obj.id.replace('PLACEHOLDER-', '');
				console.log(
					`Replacing text for PLACEHOLDER-${fieldName} with:`,
					participantData[fieldName]
				);
				obj.text = participantData[fieldName] || obj.text;
			}
		});
	}

	return JSON.stringify(canvasData);
}

async function preprocessWebPImages(canvasData: any): Promise<any> {
	if (!canvasData.objects) return canvasData;

	// Pre-process WebP images before loading into Fabric.js
	for (const obj of canvasData.objects) {
		if (obj.type === 'Image' && obj.src) {
			if (obj.src.includes('.webp') || obj.src.includes('format=webp')) {
				console.log('Found WebP image, creating fallback:', obj.src);

				// Try to create fallback URLs
				let fallbackSrc = obj.src;
				if (obj.src.includes('format=webp')) {
					fallbackSrc = obj.src.replace('format=webp', 'format=png');
				} else if (obj.src.includes('.webp')) {
					// For direct .webp files, try common alternatives
					fallbackSrc = obj.src.replace('.webp', '.jpg');
				}

				console.log('Using fallback URL:', fallbackSrc);
				obj.src = fallbackSrc;
			}
		}
	}

	return canvasData;
}

async function loadCanvasWithImageFallback(
	canvas: fabric.StaticCanvas,
	canvasData: any
): Promise<void> {
	return new Promise(async (resolve) => {
		try {
			// Preprocess WebP images first
			const processedData = await preprocessWebPImages(canvasData);

			// Load the canvas with processed data
			canvas.loadFromJSON(processedData, () => {
				canvas.renderAll();
				resolve();
			});
		} catch (error) {
			console.error('Error loading canvas:', error);
			// Even if there are errors, try to render what we can
			canvas.renderAll();
			resolve();
		}
	});
}

export async function generateCertificateThumbnail(
	certificate: Certificate,
	thumbnailWidth: number = 300,
	thumbnailHeight: number = 225
): Promise<string> {
	const canvasWidth = 800;
	const canvasHeight = 600;

	// Use the original design without replacing placeholders
	const canvasData = JSON.parse(certificate.design);

	const staticCanvas = new fabric.StaticCanvas(null, {
		width: canvasWidth,
		height: canvasHeight,
	});

	await loadCanvasWithImageFallback(staticCanvas, canvasData);

	// Generate thumbnail with specified dimensions
	const dataURL = staticCanvas.toDataURL({
		format: 'png',
		quality: 0.8,
		multiplier: Math.min(thumbnailWidth / canvasWidth, thumbnailHeight / canvasHeight),
	});

	// Convert data URL to buffer
	const base64Data = dataURL.replace(/^data:image\/png;base64,/, '');
	const imageBuffer = Buffer.from(base64Data, 'base64');

	const thumbnailFileName = `thumbnail_${certificate.id}_${Date.now()}.png`;
	const thumbnailPathInMinio = `${certificate.id}/${thumbnailFileName}`;

	console.log('Uploading certificate thumbnail to MinIO:', thumbnailPathInMinio);

	// Upload thumbnail to MinIO
	await uploadToMinio(thumbnailPathInMinio, imageBuffer, 'image/png');

	// Return the full path in MinIO
	return thumbnailPathInMinio;
}

export async function generateCertificatePDF(
	certificate: Certificate,
	participant: Participant
): Promise<string> {
	const canvasWidth = 800;
	const canvasHeight = 600;

	const replacedJson = replacePlaceholders(certificate.design, participant.data);
	const canvasData = JSON.parse(replacedJson);

	const staticCanvas = new fabric.StaticCanvas(null, {
		width: canvasWidth,
		height: canvasHeight,
	});

	await loadCanvasWithImageFallback(staticCanvas, canvasData);

	const dataURL = staticCanvas.toDataURL({
		format: 'png',
		quality: 1,
	});

	const pdf = new jsPDF({
		orientation: 'landscape',
		unit: 'px',
		format: [canvasWidth, canvasHeight],
	});

	pdf.addImage(dataURL, 'PNG', 0, 0, canvasWidth, canvasHeight);

	const fileName = `certificate_${participant.id}_${Date.now()}.pdf`;
	const filePathInMinio = `${certificate.id}/${fileName}`;
	const pdfBuffer = pdf.output('arraybuffer');

	console.log('Uploading certificate to MinIO:', filePathInMinio);

	// Upload to MinIO with certificate ID as directory
	await uploadToMinio(filePathInMinio, Buffer.from(pdfBuffer), 'application/pdf');

	// Return the full path in MinIO
	return filePathInMinio;
}

export async function createCertificateZip(
	certificate: Certificate,
	certificateFiles: string[]
): Promise<string> {
	const zipFileName = `certificates_${certificate.id}_${Date.now()}.zip`;
	const zipPathInMinio = `${certificate.id}/${zipFileName}`;

	return new Promise(async (resolve, reject) => {
		try {
			const archive = archiver('zip', {
				zlib: { level: 9 },
			});

			const chunks: Buffer[] = [];

			archive.on('data', (chunk) => {
				chunks.push(chunk);
			});

			archive.on('end', async () => {
				try {
					const zipBuffer = Buffer.concat(chunks);
					console.log(`Zip file created in memory (${zipBuffer.length} total bytes)`);

					// Upload zip to MinIO with certificate ID as directory
					await uploadToMinio(zipPathInMinio, zipBuffer, 'application/zip');

					// Return the full path in MinIO
					resolve(zipPathInMinio);
				} catch (error) {
					reject(error);
				}
			});

			archive.on('error', (err) => {
				reject(err);
			});

			// Download each certificate file from MinIO and add to zip
			for (const fileName of certificateFiles) {
				try {
					console.log(`Downloading ${fileName} from MinIO for zip`);
					const fileBuffer = await downloadFromMinio(fileName);
					archive.append(fileBuffer, { name: fileName });
				} catch (error) {
					console.error(`Error downloading ${fileName} from MinIO:`, error);
					// Continue with other files even if one fails
				}
			}

			archive.finalize();
		} catch (error) {
			reject(error);
		}
	});
}
