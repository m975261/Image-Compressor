import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import cron from "node-cron";
import { storage } from "./storage";
import { 
  conversionRequestSchema, 
  fileUploadRequestSchema,
  adminLoginRequestSchema,
  shareCreateRequestSchema,
  shareAccessRequestSchema,
  type TempDriveFile,
  type TempDriveShareFile,
  type TempDriveSession,
  type TempDriveBlockedIp
} from "@shared/schema";
import { UPLOAD_DIR, CONVERTED_DIR, SHARED_DIR, TEMP_DRIVE_DIR, getStorageInfo, isStorageNearFull } from "./config";
import {
  verifyAdminPassword,
  verifyPassword,
  hashPassword,
  generateTotpSecret,
  generateTotpQRCode,
  verifyTotp,
  generateSessionToken,
  generateShareToken,
  getSessionExpiryDate,
  isShareExpired
} from "./temp-drive-auth";

const execAsync = promisify(exec);

function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function sanitizeFilename(filename: string): string | null {
  const basename = path.basename(filename);
  if (basename !== filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return null;
  }
  return basename;
}

function isPathWithinDirectory(filePath: string, directory: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedDir = path.resolve(directory);
  return resolvedPath.startsWith(resolvedDir + path.sep) || resolvedPath === resolvedDir;
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

const MAX_LOGIN_ATTEMPTS = 3;
const BLOCK_DURATION_HOURS = 48;

async function checkAndRecordLoginAttempt(
  ip: string,
  type: "admin" | "share",
  shareId: string | null,
  success: boolean
): Promise<{ blocked: boolean; remainingAttempts: number }> {
  if (await storage.isIpBlocked(ip)) {
    return { blocked: true, remainingAttempts: 0 };
  }

  await storage.saveLoginAttempt({
    ip,
    type,
    shareId,
    success,
    timestamp: new Date().toISOString()
  });

  if (success) {
    return { blocked: false, remainingAttempts: MAX_LOGIN_ATTEMPTS };
  }

  const attempts = await storage.getLoginAttempts(ip);
  const failedCount = attempts.length;

  if (failedCount >= MAX_LOGIN_ATTEMPTS) {
    const expiresAt = new Date(Date.now() + BLOCK_DURATION_HOURS * 60 * 60 * 1000).toISOString();
    await storage.blockIp({
      ip,
      reason: type === "admin" ? "admin_login" : "share_access",
      shareId,
      blockedAt: new Date().toISOString(),
      expiresAt
    });
    return { blocked: true, remainingAttempts: 0 };
  }

  return { blocked: false, remainingAttempts: MAX_LOGIN_ATTEMPTS - failedCount };
}

const SHARE_FOLDERS_DIR = path.join(TEMP_DRIVE_DIR, "shares");

function ensureShareFolderExists(folderId: string): string {
  const folderPath = path.join(SHARE_FOLDERS_DIR, folderId);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  return folderPath;
}

function deleteShareFolder(folderId: string): void {
  const folderPath = path.join(SHARE_FOLDERS_DIR, folderId);
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }
}

const gifUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const uniqueName = `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "image/gif") {
      cb(new Error("Only GIF files are allowed"));
      return;
    }
    cb(null, true);
  }
});

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: SHARED_DIR,
    filename: (req, file, cb) => {
      const uniqueName = `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      cb(null, uniqueName);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }
});

async function getGifInfo(filePath: string): Promise<{ width: number; height: number; frames: number }> {
  try {
    const { stdout } = await execAsync(`gifsicle --info "${filePath}" 2>&1 | head -20`);
    
    const sizeMatch = stdout.match(/logical screen (\d+)x(\d+)/);
    const frameMatch = stdout.match(/(\d+) images?/);
    
    return {
      width: sizeMatch ? parseInt(sizeMatch[1]) : 0,
      height: sizeMatch ? parseInt(sizeMatch[2]) : 0,
      frames: frameMatch ? parseInt(frameMatch[1]) : 1
    };
  } catch (error) {
    return { width: 0, height: 0, frames: 1 };
  }
}

interface OptimizeOptions {
  maxSizeBytes: number;
  targetWidth?: number;
  targetHeight?: number;
}

/**
 * Process GIF to target dimensions:
 * - If source is LARGER than target: Crop from edges, keep center
 * - If source is SMALLER than target: Add white padding, center original
 * - If source equals target: Pass through
 * Preserves animation in all cases.
 */
async function processGifDimensions(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const info = await getGifInfo(inputPath);
    
    // If dimensions match, just copy
    if (info.width === targetWidth && info.height === targetHeight) {
      fs.copyFileSync(inputPath, outputPath);
      return { success: true };
    }
    
    const needsCrop = info.width > targetWidth || info.height > targetHeight;
    const needsPadding = info.width < targetWidth || info.height < targetHeight;
    
    if (needsCrop && needsPadding) {
      // Mixed case: one dimension larger, one smaller
      // First resize to fit within target while maintaining aspect ratio, then pad
      const scaleX = targetWidth / info.width;
      const scaleY = targetHeight / info.height;
      const scale = Math.min(scaleX, scaleY);
      
      const resizedWidth = Math.floor(info.width * scale);
      const resizedHeight = Math.floor(info.height * scale);
      
      // Resize first, then pad
      const tempResized = inputPath + ".resized.gif";
      await execAsync(`gifsicle --resize ${resizedWidth}x${resizedHeight} "${inputPath}" -o "${tempResized}"`);
      
      // Add padding with ImageMagick (preserves animation)
      await execAsync(`convert "${tempResized}" -coalesce -gravity center -background white -extent ${targetWidth}x${targetHeight} -layers optimize "${outputPath}"`);
      
      if (fs.existsSync(tempResized)) fs.unlinkSync(tempResized);
      return { success: true };
    }
    
    if (needsCrop) {
      // Source is larger - crop from center
      // First resize if needed to get closer to target, then crop center
      let workingPath = inputPath;
      let tempPath: string | null = null;
      
      // If much larger, resize first to reduce processing
      if (info.width > targetWidth * 1.5 || info.height > targetHeight * 1.5) {
        const scaleX = (targetWidth * 1.2) / info.width;
        const scaleY = (targetHeight * 1.2) / info.height;
        const scale = Math.max(scaleX, scaleY);
        
        const resizedWidth = Math.ceil(info.width * scale);
        const resizedHeight = Math.ceil(info.height * scale);
        
        tempPath = inputPath + ".prescale.gif";
        await execAsync(`gifsicle --resize ${resizedWidth}x${resizedHeight} "${inputPath}" -o "${tempPath}"`);
        workingPath = tempPath;
      }
      
      // Crop from center using ImageMagick (preserves animation)
      await execAsync(`convert "${workingPath}" -coalesce -gravity center -crop ${targetWidth}x${targetHeight}+0+0 +repage -layers optimize "${outputPath}"`);
      
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return { success: true };
    }
    
    if (needsPadding) {
      // Source is smaller - add white padding around it
      // Use ImageMagick to add padding while preserving animation
      await execAsync(`convert "${inputPath}" -coalesce -gravity center -background white -extent ${targetWidth}x${targetHeight} -layers optimize "${outputPath}"`);
      return { success: true };
    }
    
    // Fallback: just copy
    fs.copyFileSync(inputPath, outputPath);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Dimension processing failed" };
  }
}

async function optimizeGif(
  inputPath: string,
  outputPath: string,
  options: OptimizeOptions
): Promise<{ success: boolean; error?: string }> {
  try {
    const info = await getGifInfo(inputPath);
    const currentSize = fs.statSync(inputPath).size;
    
    const { maxSizeBytes, targetWidth, targetHeight } = options;

    // Determine if we need dimension processing
    const hasTargetDimensions = targetWidth !== undefined && targetHeight !== undefined;
    const needsDimensionProcessing = hasTargetDimensions && 
      (info.width !== targetWidth || info.height !== targetHeight);
    
    const needsSizeReduction = currentSize > maxSizeBytes;

    // If no processing needed, just copy
    if (!needsDimensionProcessing && !needsSizeReduction) {
      fs.copyFileSync(inputPath, outputPath);
      return { success: true };
    }

    let workingPath = inputPath;
    let tempDimensionPath: string | null = null;

    // Step 1: Process dimensions first (crop/pad)
    if (needsDimensionProcessing && targetWidth && targetHeight) {
      tempDimensionPath = inputPath + ".dim.gif";
      const dimResult = await processGifDimensions(inputPath, tempDimensionPath, targetWidth, targetHeight);
      if (!dimResult.success) {
        if (tempDimensionPath && fs.existsSync(tempDimensionPath)) fs.unlinkSync(tempDimensionPath);
        return dimResult;
      }
      workingPath = tempDimensionPath;
    }

    // Check if size reduction is still needed
    let resultSize = fs.statSync(workingPath).size;
    
    if (resultSize <= maxSizeBytes) {
      // Size is fine, just move/copy to output
      if (workingPath !== inputPath) {
        fs.renameSync(workingPath, outputPath);
      } else {
        fs.copyFileSync(workingPath, outputPath);
      }
      return { success: true };
    }

    // Step 2: Optimize with gifsicle for size reduction
    let cmd = `gifsicle -O3 --colors 256 "${workingPath}" -o "${outputPath}"`;
    await execAsync(cmd);
    resultSize = fs.statSync(outputPath).size;

    if (resultSize > maxSizeBytes) {
      cmd = `gifsicle -O3 --colors 128 "${workingPath}" -o "${outputPath}"`;
      await execAsync(cmd);
      resultSize = fs.statSync(outputPath).size;
    }

    if (resultSize > maxSizeBytes) {
      cmd = `gifsicle -O3 --colors 64 "${workingPath}" -o "${outputPath}"`;
      await execAsync(cmd);
      resultSize = fs.statSync(outputPath).size;
    }

    // Step 3: Frame reduction if still too large
    if (resultSize > maxSizeBytes && info.frames > 2) {
      const outputInfo = await getGifInfo(outputPath);
      let currentFrames = outputInfo.frames;
      
      while (resultSize > maxSizeBytes && currentFrames > 1) {
        const framesToKeep = Math.max(1, currentFrames - Math.ceil(currentFrames * 0.1));
        
        if (framesToKeep >= currentFrames) break;
        
        const tempPath = outputPath + ".temp.gif";
        fs.copyFileSync(outputPath, tempPath);
        
        cmd = `gifsicle "${tempPath}" "#0-${framesToKeep - 1}" -o "${outputPath}"`;
        await execAsync(cmd);
        
        fs.unlinkSync(tempPath);
        resultSize = fs.statSync(outputPath).size;
        currentFrames = framesToKeep;
      }
    }

    // Cleanup temp dimension file
    if (tempDimensionPath && fs.existsSync(tempDimensionPath)) {
      fs.unlinkSync(tempDimensionPath);
    }

    if (resultSize > maxSizeBytes) {
      return { 
        success: false, 
        error: `Could not reduce file to ${(maxSizeBytes / (1024 * 1024)).toFixed(1)}MB. Best result: ${(resultSize / (1024 * 1024)).toFixed(2)}MB` 
      };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Optimization failed" };
  }
}

async function cleanupExpiredFiles() {
  try {
    const expiredFiles = await storage.getExpiredFiles();
    
    for (const file of expiredFiles) {
      const ext = path.extname(file.fileName);
      const filePath = path.join(SHARED_DIR, file.id + ext);
      
      if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, SHARED_DIR)) {
        fs.unlinkSync(filePath);
      }
      
      await storage.deleteUploadedFile(file.id);
    }
    
    if (expiredFiles.length > 0) {
      console.log(`Cleaned up ${expiredFiles.length} expired files`);
    }
  } catch (error) {
    console.error("Error cleaning up expired files:", error);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  cron.schedule("* * * * *", cleanupExpiredFiles);

  app.post("/api/convert", gifUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const mode = req.body.mode;
      if (mode !== "yalla_ludo" && mode !== "custom") {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: "Invalid conversion mode" });
      }

      let optimizeOptions: OptimizeOptions;

      if (mode === "yalla_ludo") {
        // Yalla Ludo preset: 180x180 target dimensions, max 2MB
        optimizeOptions = {
          maxSizeBytes: 2 * 1024 * 1024,
          targetWidth: 180,
          targetHeight: 180,
        };
      } else {
        const parsed = conversionRequestSchema.safeParse({
          mode: "custom",
          maxFileSize: parseFloat(req.body.maxFileSize || "2"),
          targetWidth: req.body.targetWidth ? parseInt(req.body.targetWidth) : undefined,
          targetHeight: req.body.targetHeight ? parseInt(req.body.targetHeight) : undefined,
        });

        if (!parsed.success) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: "Invalid custom settings" });
        }

        optimizeOptions = {
          maxSizeBytes: (parsed.data.maxFileSize || 2) * 1024 * 1024,
          targetWidth: parsed.data.targetWidth,
          targetHeight: parsed.data.targetHeight,
        };
      }

      const originalInfo = await getGifInfo(req.file.path);
      const originalSize = fs.statSync(req.file.path).size;
      const originalFilename = req.file.originalname;

      const outputId = randomUUID();
      const outputPath = path.join(CONVERTED_DIR, `${outputId}.gif`);

      const result = await optimizeGif(
        req.file.path,
        outputPath,
        optimizeOptions
      );

      fs.unlinkSync(req.file.path);

      if (!result.success) {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        return res.status(422).json({ message: result.error });
      }

      const finalSize = fs.statSync(outputPath).size;
      const finalInfo = await getGifInfo(outputPath);

      const version = storage.getNextConversionVersion();
      const versionStr = String(version).padStart(2, '0');
      const baseNameWithoutExt = path.basename(originalFilename, path.extname(originalFilename));
      const first3Chars = baseNameWithoutExt.slice(0, 3).replace(/[^a-zA-Z0-9]/g, 'x') || 'xxx';
      const downloadFilename = `${first3Chars}conv${versionStr}.gif`;

      const conversionResult = await storage.saveConversionResult({
        originalSize,
        finalSize,
        originalWidth: originalInfo.width,
        originalHeight: originalInfo.height,
        finalWidth: finalInfo.width,
        finalHeight: finalInfo.height,
        frameCount: finalInfo.frames,
        downloadUrl: `/api/converted/${outputId}.gif`,
        previewUrl: `/api/converted/${outputId}.gif`,
        downloadFilename,
        success: true
      }, outputId);

      res.json(conversionResult);
    } catch (error: any) {
      console.error("Conversion error:", error);
      res.status(500).json({ message: error.message || "Conversion failed" });
    }
  });

  app.get("/api/converted/:filename", async (req, res) => {
    const sanitized = sanitizeFilename(req.params.filename);
    if (!sanitized) {
      return res.status(400).json({ message: "Invalid filename" });
    }

    if (!sanitized.endsWith(".gif")) {
      return res.status(400).json({ message: "Invalid file type" });
    }

    const fileId = sanitized.replace(".gif", "");
    if (!isValidUUID(fileId)) {
      return res.status(400).json({ message: "Invalid file identifier" });
    }

    const filePath = path.join(CONVERTED_DIR, sanitized);
    
    if (!isPathWithinDirectory(filePath, CONVERTED_DIR)) {
      return res.status(400).json({ message: "Invalid file path" });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "File not found" });
    }

    const conversionResult = await storage.getConversionResult(fileId);
    const downloadName = conversionResult?.downloadFilename || sanitized;

    res.setHeader("Content-Type", "image/gif");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.sendFile(filePath);
  });

  app.post("/api/files/upload", fileUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const parsed = fileUploadRequestSchema.safeParse({
        expiryHours: parseFloat(req.body.expiryHours || "24")
      });

      let expiryHours = parsed.success ? parsed.data.expiryHours : 24;
      if (expiryHours <= 0 || expiryHours > 24) {
        expiryHours = 24;
      }

      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
      const fileId = randomUUID();

      const ext = path.extname(req.file.originalname).replace(/[^a-zA-Z0-9.]/g, '') || '';
      const newPath = path.join(SHARED_DIR, fileId + ext);
      fs.renameSync(req.file.path, newPath);

      const uploadedFile = await storage.saveUploadedFile({
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        downloadUrl: `/api/files/download/${fileId}${ext}`,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString()
      }, fileId);

      res.json(uploadedFile);
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ message: error.message || "Upload failed" });
    }
  });

  app.get("/api/files", async (req, res) => {
    try {
      const files = await storage.getAllUploadedFiles();
      const validFiles = files.filter(file => new Date(file.expiresAt) > new Date());
      res.json(validFiles);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get files" });
    }
  });

  app.get("/api/files/download/:filename", async (req, res) => {
    try {
      const sanitized = sanitizeFilename(req.params.filename);
      if (!sanitized) {
        return res.status(400).json({ message: "Invalid filename" });
      }

      const fileId = sanitized.split(".")[0];
      if (!isValidUUID(fileId)) {
        return res.status(400).json({ message: "Invalid file identifier" });
      }
      
      const file = await storage.getUploadedFile(fileId);
      
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      if (new Date(file.expiresAt) <= new Date()) {
        return res.status(410).json({ message: "File has expired" });
      }

      const filePath = path.join(SHARED_DIR, sanitized);
      
      if (!isPathWithinDirectory(filePath, SHARED_DIR)) {
        return res.status(400).json({ message: "Invalid file path" });
      }
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }

      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
      res.sendFile(filePath);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Download failed" });
    }
  });

  app.delete("/api/files/:id", async (req, res) => {
    try {
      const fileId = req.params.id;
      if (!isValidUUID(fileId)) {
        return res.status(400).json({ message: "Invalid file identifier" });
      }

      const file = await storage.getUploadedFile(fileId);
      
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const ext = path.extname(file.fileName).replace(/[^a-zA-Z0-9.]/g, '') || '';
      const filePath = path.join(SHARED_DIR, fileId + ext);
      
      if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, SHARED_DIR)) {
        fs.unlinkSync(filePath);
      }

      await storage.deleteUploadedFile(fileId);

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Delete failed" });
    }
  });

  // ============== TEMP DRIVE ROUTES ==============

  const tempDriveUpload = multer({
    storage: multer.diskStorage({
      destination: TEMP_DRIVE_DIR,
      filename: (req, file, cb) => {
        const uniqueName = `${randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        cb(null, uniqueName);
      }
    })
  });

  async function validateTempDriveSession(req: Request): Promise<{ valid: boolean; session: TempDriveSession | null; isAdmin: boolean }> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return { valid: false, session: null, isAdmin: false };
    }
    
    const token = authHeader.substring(7);
    const session = await storage.getTempDriveSession(token);
    
    if (!session) {
      return { valid: false, session: null, isAdmin: false };
    }

    if (new Date(session.expiresAt) <= new Date()) {
      await storage.deleteTempDriveSession(token);
      return { valid: false, session: null, isAdmin: false };
    }

    if (session.type === "share") {
      const share = await storage.getTempDriveShare();
      if (!share || !share.active || isShareExpired(share.expiresAt)) {
        await storage.deleteTempDriveSession(token);
        return { valid: false, session: null, isAdmin: false };
      }
    }
    
    return { valid: true, session, isAdmin: session.type === "admin" };
  }

  app.get("/api/temp-drive/status", async (req, res) => {
    try {
      const admin = await storage.getTempDriveAdmin();
      const share = await storage.getTempDriveShare();
      
      let shareActive = false;
      if (share && share.active) {
        if (isShareExpired(share.expiresAt)) {
          await storage.deleteTempDriveShare();
        } else {
          shareActive = true;
        }
      }

      res.json({
        totpSetupComplete: admin?.totpSetupComplete || false,
        shareActive,
        shareExpiresAt: shareActive && share ? share.expiresAt : null
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get status" });
    }
  });

  app.post("/api/temp-drive/admin/login", async (req, res) => {
    try {
      const clientIp = getClientIp(req);
      
      if (await storage.isIpBlocked(clientIp)) {
        return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
      }

      const parsed = adminLoginRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const { password, otp } = parsed.data;

      const isValidPassword = await verifyAdminPassword(password);
      if (!isValidPassword) {
        const { blocked, remainingAttempts } = await checkAndRecordLoginAttempt(clientIp, "admin", null, false);
        if (blocked) {
          return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
        }
        return res.status(401).json({ message: `Invalid password. ${remainingAttempts} attempts remaining.` });
      }

      let admin = await storage.getTempDriveAdmin();

      if (!admin) {
        const totpSecret = generateTotpSecret();
        admin = {
          passwordHash: await hashPassword(password),
          totpSecret,
          totpSetupComplete: false,
          createdAt: new Date().toISOString()
        };
        await storage.saveTempDriveAdmin(admin);
      }

      if (!admin.totpSetupComplete) {
        const qrCode = await generateTotpQRCode(admin.totpSecret!);
        return res.json({
          requiresTotpSetup: true,
          qrCode,
          secret: admin.totpSecret
        });
      }

      if (!otp) {
        return res.status(400).json({ message: "OTP required", requiresOtp: true });
      }

      if (!admin.totpSecret || !verifyTotp(admin.totpSecret, otp)) {
        const { blocked, remainingAttempts } = await checkAndRecordLoginAttempt(clientIp, "admin", null, false);
        if (blocked) {
          return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
        }
        return res.status(401).json({ message: `Invalid OTP. ${remainingAttempts} attempts remaining.` });
      }

      await checkAndRecordLoginAttempt(clientIp, "admin", null, true);

      const sessionToken = generateSessionToken();
      await storage.saveTempDriveSession({
        token: sessionToken,
        type: "admin",
        shareId: null,
        expiresAt: getSessionExpiryDate().toISOString(),
        createdAt: new Date().toISOString()
      });

      res.json({ token: sessionToken, type: "admin" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Login failed" });
    }
  });

  app.post("/api/temp-drive/admin/setup-totp", async (req, res) => {
    try {
      const { password, otp } = req.body;

      const isValidPassword = await verifyAdminPassword(password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid password" });
      }

      const admin = await storage.getTempDriveAdmin();
      if (!admin || !admin.totpSecret) {
        return res.status(400).json({ message: "TOTP not initialized" });
      }

      if (!verifyTotp(admin.totpSecret, otp)) {
        return res.status(401).json({ message: "Invalid OTP" });
      }

      admin.totpSetupComplete = true;
      await storage.saveTempDriveAdmin(admin);

      const sessionToken = generateSessionToken();
      await storage.saveTempDriveSession({
        token: sessionToken,
        type: "admin",
        shareId: null,
        expiresAt: getSessionExpiryDate().toISOString(),
        createdAt: new Date().toISOString()
      });

      res.json({ token: sessionToken, type: "admin" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "TOTP setup failed" });
    }
  });

  app.post("/api/temp-drive/admin/logout", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        await storage.deleteTempDriveSession(token);
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Logout failed" });
    }
  });

  app.post("/api/temp-drive/share/create", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const parsed = shareCreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const existingShare = await storage.getTempDriveShare();
      if (existingShare && existingShare.folderId) {
        await storage.deleteAllShareFiles(existingShare.id);
        deleteShareFolder(existingShare.folderId);
      }

      const { password, expiryMinutes } = parsed.data;
      const passwordHash = await hashPassword(password);
      const shareToken = generateShareToken();
      const folderId = randomUUID();
      
      ensureShareFolderExists(folderId);
      
      const expiresAt = expiryMinutes 
        ? new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString()
        : null;

      const share = {
        id: randomUUID(),
        token: shareToken,
        passwordHash,
        folderId,
        expiresAt,
        createdAt: new Date().toISOString(),
        active: true
      };

      await storage.saveTempDriveShare(share);

      res.json({
        shareUrl: `/temp-drive/share/${shareToken}`,
        token: shareToken,
        expiresAt
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create share" });
    }
  });

  app.post("/api/temp-drive/share/disable", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const share = await storage.getTempDriveShare();
      if (share && share.folderId) {
        await storage.deleteAllShareFiles(share.id);
        deleteShareFolder(share.folderId);
      }

      await storage.deleteTempDriveShare();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to disable share" });
    }
  });

  app.post("/api/temp-drive/share/access/:token", async (req, res) => {
    try {
      const clientIp = getClientIp(req);
      
      if (await storage.isIpBlocked(clientIp)) {
        return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
      }

      const { token } = req.params;
      const parsed = shareAccessRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Password required" });
      }

      const share = await storage.getTempDriveShare();
      if (!share || share.token !== token || !share.active) {
        return res.status(404).json({ message: "Share not found or expired" });
      }

      if (isShareExpired(share.expiresAt)) {
        if (share.folderId) {
          await storage.deleteAllShareFiles(share.id);
          deleteShareFolder(share.folderId);
        }
        await storage.deleteTempDriveShare();
        return res.status(410).json({ message: "Share has expired" });
      }

      const isValidPassword = await verifyPassword(parsed.data.password, share.passwordHash);
      if (!isValidPassword) {
        const { blocked, remainingAttempts } = await checkAndRecordLoginAttempt(clientIp, "share", share.id, false);
        if (blocked) {
          return res.status(403).json({ message: "IP blocked due to too many failed attempts. Try again in 48 hours." });
        }
        return res.status(401).json({ message: `Invalid password. ${remainingAttempts} attempts remaining.` });
      }

      await checkAndRecordLoginAttempt(clientIp, "share", share.id, true);

      const sessionToken = generateSessionToken();
      await storage.saveTempDriveSession({
        token: sessionToken,
        type: "share",
        shareId: share.id,
        expiresAt: getSessionExpiryDate().toISOString(),
        createdAt: new Date().toISOString()
      });

      res.json({ token: sessionToken, type: "share" });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Access failed" });
    }
  });

  app.get("/api/temp-drive/share/validate/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const share = await storage.getTempDriveShare();
      
      if (!share || share.token !== token || !share.active) {
        return res.json({ valid: false });
      }

      if (isShareExpired(share.expiresAt)) {
        if (share.folderId) {
          await storage.deleteAllShareFiles(share.id);
          deleteShareFolder(share.folderId);
        }
        await storage.deleteTempDriveShare();
        return res.json({ valid: false });
      }

      res.json({ valid: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Validation failed" });
    }
  });

  app.get("/api/temp-drive/files", async (req, res) => {
    try {
      const { valid, session, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !session) {
        return res.status(401).json({ message: "Authentication required" });
      }

      if (isAdmin) {
        const files = await storage.getTempDriveFiles();
        res.json(files);
      } else {
        const share = await storage.getTempDriveShare();
        if (!share) {
          return res.status(404).json({ message: "Share not found" });
        }
        const files = await storage.getShareFiles(share.id);
        res.json(files);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get files" });
    }
  });

  app.post("/api/temp-drive/files/upload", tempDriveUpload.single("file"), async (req, res) => {
    try {
      const { valid, session, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !session) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(401).json({ message: "Authentication required" });
      }

      if (isStorageNearFull()) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(507).json({ message: "Storage is 95% full. Cannot upload more files." });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const fileId = randomUUID();
      const safeExt = path.extname(req.file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
      const diskFileName = `${fileId}${safeExt}`;

      if (isAdmin) {
        const newPath = path.join(TEMP_DRIVE_DIR, diskFileName);
        
        if (!isPathWithinDirectory(newPath, TEMP_DRIVE_DIR)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: "Invalid file path" });
        }
        
        fs.renameSync(req.file.path, newPath);

        const tempDriveFile: TempDriveFile = {
          id: fileId,
          fileName: req.file.originalname,
          diskFileName,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          uploadedAt: new Date().toISOString(),
          uploadedBy: "admin"
        };

        await storage.saveTempDriveFile(tempDriveFile);
        res.json(tempDriveFile);
      } else {
        const share = await storage.getTempDriveShare();
        if (!share || !share.folderId) {
          fs.unlinkSync(req.file.path);
          return res.status(404).json({ message: "Share not found" });
        }

        const folderPath = path.join(SHARE_FOLDERS_DIR, share.folderId);
        const newPath = path.join(folderPath, diskFileName);
        
        if (!isPathWithinDirectory(newPath, folderPath)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: "Invalid file path" });
        }
        
        ensureShareFolderExists(share.folderId);
        fs.renameSync(req.file.path, newPath);

        const shareFile: TempDriveShareFile = {
          id: fileId,
          shareId: share.id,
          fileName: req.file.originalname,
          diskFileName,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          uploadedAt: new Date().toISOString()
        };

        await storage.saveShareFile(shareFile);
        res.json(shareFile);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Upload failed" });
    }
  });

  function getDiskFileName(file: TempDriveFile): string {
    if (file.diskFileName) {
      return file.diskFileName;
    }
    const safeExt = path.extname(file.fileName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    return `${file.id}${safeExt}`;
  }

  app.get("/api/temp-drive/files/download/:id", async (req, res) => {
    try {
      const { valid, session, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !session) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const fileId = req.params.id;
      if (!isValidUUID(fileId)) {
        return res.status(400).json({ message: "Invalid file identifier" });
      }

      if (isAdmin) {
        const files = await storage.getTempDriveFiles();
        const file = files.find(f => f.id === fileId);
        
        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        const diskName = getDiskFileName(file);
        const filePath = path.join(TEMP_DRIVE_DIR, diskName);
        
        if (!isPathWithinDirectory(filePath, TEMP_DRIVE_DIR) || !fs.existsSync(filePath)) {
          return res.status(404).json({ message: "File not found on disk" });
        }

        const safeFileName = file.fileName.replace(/[^\w\s.-]/gi, '_');
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
        res.sendFile(filePath);
      } else {
        const share = await storage.getTempDriveShare();
        if (!share || !share.folderId) {
          return res.status(404).json({ message: "Share not found" });
        }

        const files = await storage.getShareFiles(share.id);
        const file = files.find(f => f.id === fileId);
        
        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        const folderPath = path.join(SHARE_FOLDERS_DIR, share.folderId);
        const filePath = path.join(folderPath, file.diskFileName);
        
        if (!isPathWithinDirectory(filePath, folderPath) || !fs.existsSync(filePath)) {
          return res.status(404).json({ message: "File not found on disk" });
        }

        const safeFileName = file.fileName.replace(/[^\w\s.-]/gi, '_');
        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
        res.sendFile(filePath);
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Download failed" });
    }
  });

  app.delete("/api/temp-drive/files/:id", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const fileId = req.params.id;
      if (!isValidUUID(fileId)) {
        return res.status(400).json({ message: "Invalid file identifier" });
      }

      const files = await storage.getTempDriveFiles();
      const file = files.find(f => f.id === fileId);
      
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const diskName = getDiskFileName(file);
      const filePath = path.join(TEMP_DRIVE_DIR, diskName);
      
      if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, TEMP_DRIVE_DIR)) {
        fs.unlinkSync(filePath);
      }

      await storage.deleteTempDriveFile(fileId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Delete failed" });
    }
  });

  app.delete("/api/temp-drive/files", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const files = await storage.getTempDriveFiles();
      for (const file of files) {
        const diskName = getDiskFileName(file);
        const filePath = path.join(TEMP_DRIVE_DIR, diskName);
        if (fs.existsSync(filePath) && isPathWithinDirectory(filePath, TEMP_DRIVE_DIR)) {
          fs.unlinkSync(filePath);
        }
      }

      await storage.deleteAllTempDriveFiles();
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Delete all failed" });
    }
  });

  app.get("/api/temp-drive/blocked-ips", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const blockedIps = await storage.getBlockedIps();
      res.json(blockedIps);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get blocked IPs" });
    }
  });

  app.delete("/api/temp-drive/blocked-ips/:ip", async (req, res) => {
    try {
      const { valid, isAdmin } = await validateTempDriveSession(req);
      if (!valid || !isAdmin) {
        return res.status(401).json({ message: "Admin authentication required" });
      }

      const ip = decodeURIComponent(req.params.ip);
      await storage.unblockIp(ip);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to unblock IP" });
    }
  });

  app.get("/api/temp-drive/storage", async (req, res) => {
    try {
      const info = getStorageInfo();
      res.json({
        usedBytes: info.usedBytes,
        totalBytes: info.totalBytes,
        usedPercentage: Math.round(info.usedPercentage * 100) / 100,
        warning: info.usedPercentage >= 95
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get storage info" });
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    try {
      await storage.cleanExpiredSessions();
      await storage.cleanOldLoginAttempts();
      await storage.cleanExpiredBlocks();
      
      const share = await storage.getTempDriveShare();
      if (share && share.active && isShareExpired(share.expiresAt)) {
        if (share.folderId) {
          await storage.deleteAllShareFiles(share.id);
          deleteShareFolder(share.folderId);
        }
        await storage.deleteTempDriveShare();
        console.log("Expired share and its folder cleaned up");
      }
    } catch (error) {
      console.error("Error cleaning up temp drive:", error);
    }
  });

  return httpServer;
}
