import fs from 'fs';
import path from 'path';

export async function cleanupCertificates(): Promise<void> {
	const publicDir = path.join(process.cwd(), 'public');
	
	try {
		if (!fs.existsSync(publicDir)) {
			console.log('Public directory does not exist, skipping cleanup');
			return;
		}

		const certificateDirs = fs.readdirSync(publicDir, { withFileTypes: true })
			.filter(dirent => dirent.isDirectory())
			.map(dirent => dirent.name);

		let totalFilesDeleted = 0;
		let totalDirsDeleted = 0;

		for (const certDir of certificateDirs) {
			const certPath = path.join(publicDir, certDir);
			
			try {
				// Delete all files in the certificate directory
				const files = fs.readdirSync(certPath);
				for (const file of files) {
					const filePath = path.join(certPath, file);
					fs.unlinkSync(filePath);
					totalFilesDeleted++;
				}

				// Remove the empty directory
				fs.rmdirSync(certPath);
				totalDirsDeleted++;
				
				console.log(`Cleaned up certificate directory: ${certDir}`);
			} catch (error) {
				console.error(`Error cleaning up certificate directory ${certDir}:`, error);
			}
		}

		console.log(`Cleanup completed: ${totalFilesDeleted} files and ${totalDirsDeleted} directories deleted`);
	} catch (error) {
		console.error('Error during certificate cleanup:', error);
	}
}

export function startCleanupScheduler(): void {
	console.log('Starting certificate cleanup scheduler (every 6 hours)');
	
	// Run cleanup immediately on startup
	cleanupCertificates();
	
	// Schedule cleanup every 6 hours (6 * 60 * 60 * 1000 milliseconds)
	setInterval(() => {
		console.log('Running scheduled certificate cleanup...');
		cleanupCertificates();
	}, 6 * 60 * 60 * 1000);
}