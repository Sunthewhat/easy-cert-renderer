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

	await new Promise<void>((resolve) => {
		staticCanvas.loadFromJSON(canvasData, () => {
			staticCanvas.renderAll();
			resolve();
		});
	});

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
