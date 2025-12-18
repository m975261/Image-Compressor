import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { UploadedFile, ConversionResult } from "@shared/schema";

const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), "data");
const METADATA_DIR = path.join(DATA_PATH, "metadata");
const FILES_METADATA_PATH = path.join(METADATA_DIR, "files.json");
const CONVERSIONS_METADATA_PATH = path.join(METADATA_DIR, "conversions.json");
const VERSION_METADATA_PATH = path.join(METADATA_DIR, "version.json");

export interface IStorage {
  saveUploadedFile(file: Omit<UploadedFile, "id">, customId?: string): Promise<UploadedFile>;
  getUploadedFile(id: string): Promise<UploadedFile | undefined>;
  getAllUploadedFiles(): Promise<UploadedFile[]>;
  deleteUploadedFile(id: string): Promise<boolean>;
  getExpiredFiles(): Promise<UploadedFile[]>;
  
  saveConversionResult(result: Omit<ConversionResult, "id">, customId?: string): Promise<ConversionResult>;
  getConversionResult(id: string): Promise<ConversionResult | undefined>;
  
  getNextConversionVersion(): number;
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
}

export const storage = new PersistentStorage();
