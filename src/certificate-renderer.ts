import { fabric } from 'fabric';
import jsPDF from 'jspdf';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import type { Certificate, Participant } from './types.js';

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

	const publicDir = path.join(process.cwd(), 'public', certificate.id);
	const fileName = `certificate_${participant.id}_${Date.now()}.pdf`;
	const filePath = path.join(publicDir, fileName);

	console.log('Creating directory:', publicDir);
	console.log('Saving file to:', filePath);

	if (!fs.existsSync(publicDir)) {
		fs.mkdirSync(publicDir, { recursive: true });
	}

	const pdfBuffer = pdf.output('arraybuffer');
	fs.writeFileSync(filePath, Buffer.from(pdfBuffer));

	// Return only the file name
	return fileName;
}

export async function createCertificateZip(
	certificate: Certificate,
	certificateFiles: string[]
): Promise<string> {
	const publicDir = path.join(process.cwd(), 'public', certificate.id);
	const zipFileName = `certificates_${certificate.id}_${Date.now()}.zip`;
	const zipFilePath = path.join(publicDir, zipFileName);

	return new Promise((resolve, reject) => {
		const output = fs.createWriteStream(zipFilePath);
		const archive = archiver('zip', {
			zlib: { level: 9 },
		});

		output.on('close', () => {
			console.log(`Zip file created: ${zipFilePath} (${archive.pointer()} total bytes)`);
			// Return only the zip file name
			resolve(zipFileName);
		});

		archive.on('error', (err) => {
			reject(err);
		});

		archive.pipe(output);

		// Add each certificate file to the zip
		certificateFiles.forEach((fileName) => {
			const absolutePath = path.join(publicDir, fileName);
			if (fs.existsSync(absolutePath)) {
				archive.file(absolutePath, { name: fileName });
			}
		});

		archive.finalize();
	});
}
