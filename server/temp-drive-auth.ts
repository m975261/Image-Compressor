import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import crypto from "crypto";

const ADMIN_PASSWORD = "Trilli0n$@P9crkmm6@Milli0n$";
const SALT_ROUNDS = 12;
const SESSION_DURATION_HOURS = 4;
const APP_NAME = "FileTools TempDrive";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  return password === ADMIN_PASSWORD;
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
