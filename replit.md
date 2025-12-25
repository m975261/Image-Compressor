# File Tools - Replit Agent Guide

## Overview

A file utility web application with two main features: animated GIF conversion and temporary file sharing. Built as a full-stack TypeScript application with React frontend and Express backend.

**Core Features:**
- **Image Converter**: Upload animated GIFs and convert them with preset (Yalla Ludo) or custom size/dimension settings
- **Temporary File Sharing**: Upload files with configurable expiry times (up to 24 hours) and shareable download links

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
- `POST /api/convert` - GIF conversion endpoint
- `GET/POST /api/files` - File sharing CRUD operations
- Files served from filesystem directories

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
- Relies on external CLI tools (likely gifsicle or similar) via `child_process.exec` for GIF manipulation

### Key NPM Packages
- `multer` - File upload handling
- `node-cron` - Scheduled tasks for file cleanup
- `uuid` - Unique file naming
- `zod` - Runtime validation
- `@tanstack/react-query` - Data fetching/caching
- `wouter` - Client-side routing