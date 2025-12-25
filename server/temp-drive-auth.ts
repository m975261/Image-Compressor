import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import crypto from "crypto";

const SALT_ROUNDS = 12;
const SESSION_DURATION_HOURS = 4;
const APP_NAME = "FileTools TempDrive";

const ADMIN_PASSWORD_HASH = process.env.TEMP_DRIVE_ADMIN_HASH || 
  "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4nQIALQJpqHvCmOe";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  return bcrypt.compare(password, ADMIN_PASSWORD_HASH);
}

export function generateTotpSecret(): string {
  const secret = new OTPAuth.Secret({ size: 20 });
  return secret.base32;
}

export function createTotpUri(secret: string, accountName: string = "admin"): string {
  const totp = new OTPAuth.TOTP({
    issuer: APP_NAME,
    label: accountName,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.toString();
}

export async function generateTotpQRCode(secret: string): Promise<string> {
  const uri = createTotpUri(secret);
  return QRCode.toDataURL(uri);
}

export function verifyTotp(secret: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: APP_NAME,
    label: "admin",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generateShareToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function getSessionExpiryDate(): Date {
  return new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
}

export function isSessionExpired(expiresAt: string): boolean {
  return new Date(expiresAt) <= new Date();
}

export function isShareExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  return new Date(expiresAt) <= new Date();
}
