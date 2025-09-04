import * as Minio from 'minio';

const minioConfig = {
	endPoint: Bun.env.MINIO_ENDPOINT ?? '',
	accessKey: Bun.env.MINIO_ACCESS ?? '',
	secretKey: Bun.env.MINIO_SECRET ?? '',
	useSSL: true,
};

const bucketName = Bun.env.MINIO_BUCKET ?? '';

const minioClient = new Minio.Client(minioConfig);

export async function uploadToMinio(
	fileName: string,
	buffer: Buffer,
	contentType: string = 'application/octet-stream'
): Promise<string> {
	try {
		console.log('MinIO Config:', {
			endPoint: minioConfig.endPoint,
			accessKey: minioConfig.accessKey,
			secretKey: minioConfig.secretKey ? '***' : 'missing',
			bucketName: bucketName,
			useSSL: minioConfig.useSSL
		});

		// Ensure bucket exists
		const bucketExists = await minioClient.bucketExists(bucketName);
		console.log(`Bucket ${bucketName} exists:`, bucketExists);
		
		if (!bucketExists) {
			console.log(`Creating bucket: ${bucketName}`);
			await minioClient.makeBucket(bucketName, 'us-east-1');
		}

		// Upload the buffer to MinIO
		await minioClient.putObject(bucketName, fileName, buffer, buffer.length, {
			'Content-Type': contentType,
		});

		console.log(`File uploaded to MinIO: ${fileName}`);
		return fileName;
	} catch (error) {
		console.error('Error uploading to MinIO:', error);
		console.error('MinIO client config being used:', {
			endPoint: minioConfig.endPoint,
			accessKey: minioConfig.accessKey,
			bucketName: bucketName
		});
		throw error;
	}
}

export async function getFileUrl(
	fileName: string,
	expires: number = 7 * 24 * 60 * 60
): Promise<string> {
	try {
		// Generate a presigned URL for the file (expires in 7 days by default)
		const url = await minioClient.presignedGetObject(bucketName, fileName, expires);
		return url;
	} catch (error) {
		console.error('Error generating presigned URL:', error);
		throw error;
	}
}

export async function downloadFromMinio(fileName: string): Promise<Buffer> {
	try {
		const stream = await minioClient.getObject(bucketName, fileName);
		const chunks: Buffer[] = [];

		return new Promise((resolve, reject) => {
			stream.on('data', (chunk) => chunks.push(chunk));
			stream.on('error', reject);
			stream.on('end', () => resolve(Buffer.concat(chunks)));
		});
	} catch (error) {
		console.error('Error downloading from MinIO:', error);
		throw error;
	}
}

export async function deleteFromMinio(fileName: string): Promise<void> {
	try {
		await minioClient.removeObject(bucketName, fileName);
		console.log(`File deleted from MinIO: ${fileName}`);
	} catch (error) {
		console.error('Error deleting from MinIO:', error);
		throw error;
	}
}

export async function listMinioObjects(prefix: string): Promise<string[]> {
	try {
		const objects: string[] = [];
		const stream = minioClient.listObjects(bucketName, prefix, true);
		
		return new Promise((resolve, reject) => {
			stream.on('data', (obj) => {
				if (obj.name) {
					objects.push(obj.name);
				}
			});
			stream.on('error', reject);
			stream.on('end', () => resolve(objects));
		});
	} catch (error) {
		console.error('Error listing MinIO objects:', error);
		throw error;
	}
}
