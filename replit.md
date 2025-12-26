# File Tools - Replit Agent Guide

## Overview

A file utility web application with animated image conversion, temporary file sharing, and a multi-share Temp Drive system. Built as a full-stack TypeScript application with React frontend and Express backend, Docker-ready for Unraid deployment.

**Core Features:**
- **Image Converter**: Upload animated images (GIF, WebP, AVIF) and convert to GIF with optimization
  - Yalla Ludo preset: 2MB max, 180x180px minimum (pads smaller images)
  - Custom mode: User-defined max file size
  - Pre-processing metadata display (dimensions, file size, frame count)
  - Strict fallback: Non-destructive optimization first, user approval required for frame reduction
- **Temporary File Sharing**: Upload files with configurable expiry times (up to 24 hours) and shareable download links
- **Temp Drive**: Multi-share system with admin dashboard, password + 2FA protection, 1GB quotas per share
- **Homepage Authentication**: Password-protected access to tools using admin password (share links remain public)

## User Preferences

Preferred communication style: Simple, everyday language.

**GitHub Repository**: https://github.com/m975261/Image-Compressor
- Always push updates to this repo when syncing to GitHub
- Do NOT use any other repo name for this project

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight router)
- **State Management**: TanStack React Query for server state
- **UI Components**: Shadcn/ui with Radix primitives
- **Styling**: Tailwind CSS with custom design tokens (Material Design 3 influenced)
- **Build Tool**: Vite with path aliases (`@/` for client/src, `@shared/` for shared)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **File Handling**: Multer for multipart uploads
- **Directory Structure**:
  - `uploads/` - Temporary GIF uploads for conversion
  - `converted/` - Processed GIF outputs
  - `shared_files/` - Temporary file sharing storage

### Data Layer
- **ORM**: Drizzle ORM configured for PostgreSQL
- **Current Storage**: In-memory storage (`MemStorage` class) for file metadata
- **Schema Location**: `shared/schema.ts` contains Zod schemas for validation

### API Structure
- `GET /api/health` - Docker health check endpoint
- `POST /api/image/metadata` - Get pre-processing image info (dimensions, frames)
- `POST /api/convert` - Animated image to GIF conversion (supports WebP, AVIF, GIF input)
- `GET/POST /api/files` - File sharing CRUD operations
- `GET/POST /api/home/*` - Homepage authentication (login, session, logout)
- `GET/POST /api/temp-drive/*` - Temp Drive admin and share endpoints
- Files served from filesystem directories

### Authentication
- Homepage tools: Protected by admin password (TEMP_DRIVE_ADMIN_HASH bcrypt hash)
- Temp Drive admin: Same password + optional TOTP 2FA
- Share links: Public access (no auth required)
- IP blocking: 5 failed attempts = 48-hour block

### Key Design Decisions

1. **Shared Schema Pattern**: Zod schemas in `shared/` directory enable type-safe validation on both client and server

2. **In-Memory Storage Default**: Uses `MemStorage` class that can be swapped for database-backed storage when PostgreSQL is provisioned

3. **File-Based Asset Storage**: Converted files and shared files stored on filesystem rather than database blobs for simplicity

4. **Scheduled Cleanup**: Uses node-cron for expired file cleanup tasks

## External Dependencies

### Database
- PostgreSQL (via Drizzle ORM) - requires `DATABASE_URL` environment variable
- Drizzle Kit for migrations (`drizzle.config.ts`)

### Image Processing
- **gifsicle**: GIF optimization, frame reduction, palette manipulation
- **ffmpeg**: Format conversion (WebP/AVIF to GIF)
- Processing rules:
  - Minimum 180x180px with edge-color padding (no cropping)
  - Palette optimization before frame reduction
  - Frame reduction requires explicit user approval

### Key NPM Packages
- `multer` - File upload handling
- `node-cron` - Scheduled tasks for file cleanup
- `uuid` - Unique file naming
- `zod` - Runtime validation
- `@tanstack/react-query` - Data fetching/caching
- `wouter` - Client-side routing