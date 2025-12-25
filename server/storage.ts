import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { 
  UploadedFile, 
  ConversionResult, 
  TempDriveAdmin, 
  TempDriveFile, 
  TempDriveShare, 
  TempDriveShareFile,
  TempDriveSession,
  TempDriveLoginAttempt,
  TempDriveBlockedIp,
  TempDriveGlobalSettings
} from "@shared/schema";

const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), "data");
const METADATA_DIR = path.join(DATA_PATH, "metadata");
const FILES_METADATA_PATH = path.join(METADATA_DIR, "files.json");
const CONVERSIONS_METADATA_PATH = path.join(METADATA_DIR, "conversions.json");
const VERSION_METADATA_PATH = path.join(METADATA_DIR, "version.json");
const TEMP_DRIVE_ADMIN_PATH = path.join(METADATA_DIR, "temp_drive_admin.json");
const TEMP_DRIVE_FILES_PATH = path.join(METADATA_DIR, "temp_drive_files.json");
const TEMP_DRIVE_SHARES_PATH = path.join(METADATA_DIR, "temp_drive_shares.json");
const TEMP_DRIVE_SESSIONS_PATH = path.join(METADATA_DIR, "temp_drive_sessions.json");
const TEMP_DRIVE_SHARE_FILES_PATH = path.join(METADATA_DIR, "temp_drive_share_files.json");
const TEMP_DRIVE_LOGIN_ATTEMPTS_PATH = path.join(METADATA_DIR, "temp_drive_login_attempts.json");
const TEMP_DRIVE_BLOCKED_IPS_PATH = path.join(METADATA_DIR, "temp_drive_blocked_ips.json");
const TEMP_DRIVE_GLOBAL_SETTINGS_PATH = path.join(METADATA_DIR, "temp_drive_global_settings.json");

export interface IStorage {
  saveUploadedFile(file: Omit<UploadedFile, "id">, customId?: string): Promise<UploadedFile>;
  getUploadedFile(id: string): Promise<UploadedFile | undefined>;
  getAllUploadedFiles(): Promise<UploadedFile[]>;
  deleteUploadedFile(id: string): Promise<boolean>;
  getExpiredFiles(): Promise<UploadedFile[]>;
  
  saveConversionResult(result: Omit<ConversionResult, "id">, customId?: string): Promise<ConversionResult>;
  getConversionResult(id: string): Promise<ConversionResult | undefined>;
  
  getNextConversionVersion(): number;

  getTempDriveAdmin(): Promise<TempDriveAdmin | null>;
  saveTempDriveAdmin(admin: TempDriveAdmin): Promise<void>;
  
  getTempDriveFiles(): Promise<TempDriveFile[]>;
  saveTempDriveFile(file: TempDriveFile): Promise<TempDriveFile>;
  deleteTempDriveFile(id: string): Promise<boolean>;
  deleteAllTempDriveFiles(): Promise<void>;
  
  getAllTempDriveShares(): Promise<TempDriveShare[]>;
  getTempDriveShare(id: string): Promise<TempDriveShare | null>;
  getTempDriveShareByToken(token: string): Promise<TempDriveShare | null>;
  saveTempDriveShare(share: TempDriveShare): Promise<void>;
  updateTempDriveShare(id: string, updates: Partial<TempDriveShare>): Promise<TempDriveShare | null>;
  deleteTempDriveShare(id: string): Promise<boolean>;
  
  getGlobalSettings(): Promise<TempDriveGlobalSettings>;
  saveGlobalSettings(settings: TempDriveGlobalSettings): Promise<void>;
  
  getShareFiles(shareId: string): Promise<TempDriveShareFile[]>;
  saveShareFile(file: TempDriveShareFile): Promise<TempDriveShareFile>;
  deleteShareFile(id: string): Promise<boolean>;
  deleteAllShareFiles(shareId: string): Promise<void>;
  
  getLoginAttempts(ip: string): Promise<TempDriveLoginAttempt[]>;
  saveLoginAttempt(attempt: TempDriveLoginAttempt): Promise<void>;
  cleanOldLoginAttempts(): Promise<void>;
  
  getBlockedIps(): Promise<TempDriveBlockedIp[]>;
  isIpBlocked(ip: string): Promise<boolean>;
  blockIp(blockedIp: TempDriveBlockedIp): Promise<void>;
  unblockIp(ip: string): Promise<void>;
  cleanExpiredBlocks(): Promise<void>;
  
  getTempDriveSession(token: string): Promise<TempDriveSession | null>;
  saveTempDriveSession(session: TempDriveSession): Promise<void>;
  deleteTempDriveSession(token: string): Promise<void>;
  cleanExpiredSessions(): Promise<void>;
}

interface VersionData {
  conversionVersion: number;
  lastConversionDate: string;
}

export class PersistentStorage implements IStorage {
  private uploadedFiles: Map<string, UploadedFile>;
  private conversionResults: Map<string, ConversionResult>;
  private conversionVersion: number;
  private lastConversionDate: string;

  constructor() {
    this.uploadedFiles = new Map();
    this.conversionResults = new Map();
    this.conversionVersion = 0;
    this.lastConversionDate = this.getTodayDateString();
    this.ensureMetadataDir();
    this.loadFromDisk();
  }

  private ensureMetadataDir(): void {
    if (!fs.existsSync(METADATA_DIR)) {
      fs.mkdirSync(METADATA_DIR, { recursive: true });
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(FILES_METADATA_PATH)) {
        const data = JSON.parse(fs.readFileSync(FILES_METADATA_PATH, "utf-8"));
        this.uploadedFiles = new Map(Object.entries(data));
      }
    } catch (error) {
      console.error("Error loading files metadata:", error);
    }

    try {
      if (fs.existsSync(CONVERSIONS_METADATA_PATH)) {
        const data = JSON.parse(fs.readFileSync(CONVERSIONS_METADATA_PATH, "utf-8"));
        this.conversionResults = new Map(Object.entries(data));
      }
    } catch (error) {
      console.error("Error loading conversions metadata:", error);
    }

    try {
      if (fs.existsSync(VERSION_METADATA_PATH)) {
        const data: VersionData = JSON.parse(fs.readFileSync(VERSION_METADATA_PATH, "utf-8"));
        this.conversionVersion = data.conversionVersion || 0;
        this.lastConversionDate = data.lastConversionDate || this.getTodayDateString();
      }
    } catch (error) {
      console.error("Error loading version metadata:", error);
    }
  }

  private saveFilesToDisk(): void {
    try {
      const data = Object.fromEntries(this.uploadedFiles);
      fs.writeFileSync(FILES_METADATA_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Error saving files metadata:", error);
    }
  }

  private saveConversionsToDisk(): void {
    try {
      const data = Object.fromEntries(this.conversionResults);
      fs.writeFileSync(CONVERSIONS_METADATA_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Error saving conversions metadata:", error);
    }
  }

  private saveVersionToDisk(): void {
    try {
      const data: VersionData = {
        conversionVersion: this.conversionVersion,
        lastConversionDate: this.lastConversionDate
      };
      fs.writeFileSync(VERSION_METADATA_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Error saving version metadata:", error);
    }
  }

  private getTodayDateString(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  getNextConversionVersion(): number {
    const today = this.getTodayDateString();
    if (today !== this.lastConversionDate) {
      this.conversionVersion = 0;
      this.lastConversionDate = today;
    }
    this.conversionVersion++;
    this.saveVersionToDisk();
    return this.conversionVersion;
  }

  async saveUploadedFile(file: Omit<UploadedFile, "id">, customId?: string): Promise<UploadedFile> {
    const id = customId || randomUUID();
    const uploadedFile: UploadedFile = { ...file, id };
    this.uploadedFiles.set(id, uploadedFile);
    this.saveFilesToDisk();
    return uploadedFile;
  }

  async getUploadedFile(id: string): Promise<UploadedFile | undefined> {
    return this.uploadedFiles.get(id);
  }

  async getAllUploadedFiles(): Promise<UploadedFile[]> {
    return Array.from(this.uploadedFiles.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async deleteUploadedFile(id: string): Promise<boolean> {
    const result = this.uploadedFiles.delete(id);
    if (result) {
      this.saveFilesToDisk();
    }
    return result;
  }

  async getExpiredFiles(): Promise<UploadedFile[]> {
    const now = new Date();
    return Array.from(this.uploadedFiles.values()).filter(
      file => new Date(file.expiresAt) <= now
    );
  }

  async saveConversionResult(result: Omit<ConversionResult, "id">, customId?: string): Promise<ConversionResult> {
    const id = customId || randomUUID();
    const conversionResult: ConversionResult = { ...result, id };
    this.conversionResults.set(id, conversionResult);
    this.saveConversionsToDisk();
    return conversionResult;
  }

  async getConversionResult(id: string): Promise<ConversionResult | undefined> {
    return this.conversionResults.get(id);
  }

  async getTempDriveAdmin(): Promise<TempDriveAdmin | null> {
    try {
      if (fs.existsSync(TEMP_DRIVE_ADMIN_PATH)) {
        return JSON.parse(fs.readFileSync(TEMP_DRIVE_ADMIN_PATH, "utf-8"));
      }
    } catch (error) {
      console.error("Error loading temp drive admin:", error);
    }
    return null;
  }

  async saveTempDriveAdmin(admin: TempDriveAdmin): Promise<void> {
    try {
      fs.writeFileSync(TEMP_DRIVE_ADMIN_PATH, JSON.stringify(admin, null, 2));
    } catch (error) {
      console.error("Error saving temp drive admin:", error);
    }
  }

  async getTempDriveFiles(): Promise<TempDriveFile[]> {
    try {
      if (fs.existsSync(TEMP_DRIVE_FILES_PATH)) {
        const data = JSON.parse(fs.readFileSync(TEMP_DRIVE_FILES_PATH, "utf-8"));
        return Array.isArray(data) ? data : [];
      }
    } catch (error) {
      console.error("Error loading temp drive files:", error);
    }
    return [];
  }

  async saveTempDriveFile(file: TempDriveFile): Promise<TempDriveFile> {
    const files = await this.getTempDriveFiles();
    files.push(file);
    try {
      fs.writeFileSync(TEMP_DRIVE_FILES_PATH, JSON.stringify(files, null, 2));
    } catch (error) {
      console.error("Error saving temp drive files:", error);
    }
    return file;
  }

  async deleteTempDriveFile(id: string): Promise<boolean> {
    const files = await this.getTempDriveFiles();
    const filtered = files.filter(f => f.id !== id);
    if (filtered.length < files.length) {
      try {
        fs.writeFileSync(TEMP_DRIVE_FILES_PATH, JSON.stringify(filtered, null, 2));
      } catch (error) {
        console.error("Error saving temp drive files:", error);
      }
      return true;
    }
    return false;
  }

  async deleteAllTempDriveFiles(): Promise<void> {
    try {
      fs.writeFileSync(TEMP_DRIVE_FILES_PATH, JSON.stringify([], null, 2));
    } catch (error) {
      console.error("Error clearing temp drive files:", error);
    }
  }

  async getAllTempDriveShares(): Promise<TempDriveShare[]> {
    try {
      if (fs.existsSync(TEMP_DRIVE_SHARES_PATH)) {
        const data = JSON.parse(fs.readFileSync(TEMP_DRIVE_SHARES_PATH, "utf-8"));
        if (Array.isArray(data)) {
          return data;
        }
        if (data && data.id) {
          const migrated: TempDriveShare = {
            ...data,
            label: data.label || "Share 1",
            usedBytes: data.usedBytes || 0,
          };
          await this.saveAllShares([migrated]);
          return [migrated];
        }
      }
    } catch (error) {
      console.error("Error loading temp drive shares:", error);
    }
    return [];
  }

  private async saveAllShares(shares: TempDriveShare[]): Promise<void> {
    try {
      fs.writeFileSync(TEMP_DRIVE_SHARES_PATH, JSON.stringify(shares, null, 2));
    } catch (error) {
      console.error("Error saving shares:", error);
    }
  }

  async getTempDriveShare(id: string): Promise<TempDriveShare | null> {
    const shares = await this.getAllTempDriveShares();
    return shares.find(s => s.id === id) || null;
  }

  async getTempDriveShareByToken(token: string): Promise<TempDriveShare | null> {
    const shares = await this.getAllTempDriveShares();
    return shares.find(s => s.token === token) || null;
  }

  async saveTempDriveShare(share: TempDriveShare): Promise<void> {
    const shares = await this.getAllTempDriveShares();
    const existing = shares.findIndex(s => s.id === share.id);
    if (existing >= 0) {
      shares[existing] = share;
    } else {
      shares.push(share);
    }
    await this.saveAllShares(shares);
  }

  async updateTempDriveShare(id: string, updates: Partial<TempDriveShare>): Promise<TempDriveShare | null> {
    const shares = await this.getAllTempDriveShares();
    const index = shares.findIndex(s => s.id === id);
    if (index < 0) return null;
    shares[index] = { ...shares[index], ...updates };
    await this.saveAllShares(shares);
    return shares[index];
  }

  async deleteTempDriveShare(id: string): Promise<boolean> {
    const shares = await this.getAllTempDriveShares();
    const filtered = shares.filter(s => s.id !== id);
    if (filtered.length < shares.length) {
      await this.saveAllShares(filtered);
      return true;
    }
    return false;
  }

  async getGlobalSettings(): Promise<TempDriveGlobalSettings> {
    try {
      if (fs.existsSync(TEMP_DRIVE_GLOBAL_SETTINGS_PATH)) {
        return JSON.parse(fs.readFileSync(TEMP_DRIVE_GLOBAL_SETTINGS_PATH, "utf-8"));
      }
    } catch (error) {
      console.error("Error loading global settings:", error);
    }
    return { sharingEnabled: true };
  }

  async saveGlobalSettings(settings: TempDriveGlobalSettings): Promise<void> {
    try {
      fs.writeFileSync(TEMP_DRIVE_GLOBAL_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error("Error saving global settings:", error);
    }
  }

  private sessions: Map<string, TempDriveSession> = new Map();

  async getTempDriveSession(token: string): Promise<TempDriveSession | null> {
    await this.loadSessions();
    const session = this.sessions.get(token);
    if (session && new Date(session.expiresAt) <= new Date()) {
      this.sessions.delete(token);
      await this.saveSessions();
      return null;
    }
    return session || null;
  }

  async saveTempDriveSession(session: TempDriveSession): Promise<void> {
    await this.loadSessions();
    this.sessions.set(session.token, session);
    await this.saveSessions();
  }

  async deleteTempDriveSession(token: string): Promise<void> {
    await this.loadSessions();
    this.sessions.delete(token);
    await this.saveSessions();
  }

  async cleanExpiredSessions(): Promise<void> {
    await this.loadSessions();
    const now = new Date();
    const tokens = Array.from(this.sessions.keys());
    for (const token of tokens) {
      const session = this.sessions.get(token);
      if (session && new Date(session.expiresAt) <= now) {
        this.sessions.delete(token);
      }
    }
    await this.saveSessions();
  }

  private async loadSessions(): Promise<void> {
    try {
      if (fs.existsSync(TEMP_DRIVE_SESSIONS_PATH)) {
        const data = JSON.parse(fs.readFileSync(TEMP_DRIVE_SESSIONS_PATH, "utf-8"));
        this.sessions = new Map(Object.entries(data));
      }
    } catch (error) {
      console.error("Error loading sessions:", error);
    }
  }

  private async saveSessions(): Promise<void> {
    try {
      const data = Object.fromEntries(this.sessions);
      fs.writeFileSync(TEMP_DRIVE_SESSIONS_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Error saving sessions:", error);
    }
  }

  async getShareFiles(shareId: string): Promise<TempDriveShareFile[]> {
    try {
      if (fs.existsSync(TEMP_DRIVE_SHARE_FILES_PATH)) {
        const data: TempDriveShareFile[] = JSON.parse(fs.readFileSync(TEMP_DRIVE_SHARE_FILES_PATH, "utf-8"));
        return data.filter(f => f.shareId === shareId);
      }
    } catch (error) {
      console.error("Error loading share files:", error);
    }
    return [];
  }

  async saveShareFile(file: TempDriveShareFile): Promise<TempDriveShareFile> {
    let files: TempDriveShareFile[] = [];
    try {
      if (fs.existsSync(TEMP_DRIVE_SHARE_FILES_PATH)) {
        files = JSON.parse(fs.readFileSync(TEMP_DRIVE_SHARE_FILES_PATH, "utf-8"));
      }
    } catch (error) {
      console.error("Error loading share files:", error);
    }
    files.push(file);
    try {
      fs.writeFileSync(TEMP_DRIVE_SHARE_FILES_PATH, JSON.stringify(files, null, 2));
    } catch (error) {
      console.error("Error saving share files:", error);
    }
    return file;
  }

  async deleteShareFile(id: string): Promise<boolean> {
    try {
      if (fs.existsSync(TEMP_DRIVE_SHARE_FILES_PATH)) {
        const files: TempDriveShareFile[] = JSON.parse(fs.readFileSync(TEMP_DRIVE_SHARE_FILES_PATH, "utf-8"));
        const filtered = files.filter(f => f.id !== id);
        if (filtered.length < files.length) {
          fs.writeFileSync(TEMP_DRIVE_SHARE_FILES_PATH, JSON.stringify(filtered, null, 2));
          return true;
        }
      }
    } catch (error) {
      console.error("Error deleting share file:", error);
    }
    return false;
  }

  async deleteAllShareFiles(shareId: string): Promise<void> {
    try {
      if (fs.existsSync(TEMP_DRIVE_SHARE_FILES_PATH)) {
        const files: TempDriveShareFile[] = JSON.parse(fs.readFileSync(TEMP_DRIVE_SHARE_FILES_PATH, "utf-8"));
        const filtered = files.filter(f => f.shareId !== shareId);
        fs.writeFileSync(TEMP_DRIVE_SHARE_FILES_PATH, JSON.stringify(filtered, null, 2));
      }
    } catch (error) {
      console.error("Error deleting share files:", error);
    }
  }

  async getLoginAttempts(ip: string): Promise<TempDriveLoginAttempt[]> {
    try {
      if (fs.existsSync(TEMP_DRIVE_LOGIN_ATTEMPTS_PATH)) {
        const data: TempDriveLoginAttempt[] = JSON.parse(fs.readFileSync(TEMP_DRIVE_LOGIN_ATTEMPTS_PATH, "utf-8"));
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        return data.filter(a => a.ip === ip && a.timestamp > oneHourAgo && !a.success);
      }
    } catch (error) {
      console.error("Error loading login attempts:", error);
    }
    return [];
  }

  async saveLoginAttempt(attempt: TempDriveLoginAttempt): Promise<void> {
    let attempts: TempDriveLoginAttempt[] = [];
    try {
      if (fs.existsSync(TEMP_DRIVE_LOGIN_ATTEMPTS_PATH)) {
        attempts = JSON.parse(fs.readFileSync(TEMP_DRIVE_LOGIN_ATTEMPTS_PATH, "utf-8"));
      }
    } catch (error) {
      console.error("Error loading login attempts:", error);
    }
    attempts.push(attempt);
    try {
      fs.writeFileSync(TEMP_DRIVE_LOGIN_ATTEMPTS_PATH, JSON.stringify(attempts, null, 2));
    } catch (error) {
      console.error("Error saving login attempt:", error);
    }
  }

  async cleanOldLoginAttempts(): Promise<void> {
    try {
      if (fs.existsSync(TEMP_DRIVE_LOGIN_ATTEMPTS_PATH)) {
        const attempts: TempDriveLoginAttempt[] = JSON.parse(fs.readFileSync(TEMP_DRIVE_LOGIN_ATTEMPTS_PATH, "utf-8"));
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const filtered = attempts.filter(a => a.timestamp > oneHourAgo);
        fs.writeFileSync(TEMP_DRIVE_LOGIN_ATTEMPTS_PATH, JSON.stringify(filtered, null, 2));
      }
    } catch (error) {
      console.error("Error cleaning login attempts:", error);
    }
  }

  async getBlockedIps(): Promise<TempDriveBlockedIp[]> {
    try {
      if (fs.existsSync(TEMP_DRIVE_BLOCKED_IPS_PATH)) {
        const data: TempDriveBlockedIp[] = JSON.parse(fs.readFileSync(TEMP_DRIVE_BLOCKED_IPS_PATH, "utf-8"));
        return data;
      }
    } catch (error) {
      console.error("Error loading blocked IPs:", error);
    }
    return [];
  }

  async isIpBlocked(ip: string): Promise<boolean> {
    const blockedIps = await this.getBlockedIps();
    const now = new Date().toISOString();
    return blockedIps.some(b => b.ip === ip && b.expiresAt > now);
  }

  async blockIp(blockedIp: TempDriveBlockedIp): Promise<void> {
    let blocked = await this.getBlockedIps();
    blocked = blocked.filter(b => b.ip !== blockedIp.ip);
    blocked.push(blockedIp);
    try {
      fs.writeFileSync(TEMP_DRIVE_BLOCKED_IPS_PATH, JSON.stringify(blocked, null, 2));
    } catch (error) {
      console.error("Error blocking IP:", error);
    }
  }

  async unblockIp(ip: string): Promise<void> {
    try {
      if (fs.existsSync(TEMP_DRIVE_BLOCKED_IPS_PATH)) {
        const blocked: TempDriveBlockedIp[] = JSON.parse(fs.readFileSync(TEMP_DRIVE_BLOCKED_IPS_PATH, "utf-8"));
        const filtered = blocked.filter(b => b.ip !== ip);
        fs.writeFileSync(TEMP_DRIVE_BLOCKED_IPS_PATH, JSON.stringify(filtered, null, 2));
      }
    } catch (error) {
      console.error("Error unblocking IP:", error);
    }
  }

  async cleanExpiredBlocks(): Promise<void> {
    try {
      if (fs.existsSync(TEMP_DRIVE_BLOCKED_IPS_PATH)) {
        const blocked: TempDriveBlockedIp[] = JSON.parse(fs.readFileSync(TEMP_DRIVE_BLOCKED_IPS_PATH, "utf-8"));
        const now = new Date().toISOString();
        const filtered = blocked.filter(b => b.expiresAt > now);
        fs.writeFileSync(TEMP_DRIVE_BLOCKED_IPS_PATH, JSON.stringify(filtered, null, 2));
      }
    } catch (error) {
      console.error("Error cleaning expired blocks:", error);
    }
  }
}

export const storage = new PersistentStorage();
