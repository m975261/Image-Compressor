# File Tools

A file utility web application with two main features:
- **Image Converter**: Upload animated GIFs and convert them with preset (Yalla Ludo: 2MB/180x180px) or custom size/dimension settings
- **Temporary File Sharing**: Upload files with configurable expiry times (up to 24 hours) and shareable download links

## Features

- GIF optimization with frame preservation using gifsicle
- Before/after comparison display for conversions
- Automatic file cleanup after expiry
- Custom download filename format for converted GIFs
- Original filename preservation for shared files

## Requirements

- Node.js 20+
- gifsicle (for GIF processing)
- ffmpeg (for media processing)

## Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev
```

The application will be available at `http://localhost:4321`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4321` | Server port |
| `DATA_PATH` | `./data` | Directory for all file storage |

## Docker

### Build

```bash
docker build -t file-tools .
```

### Run

```bash
docker run -d \
  -p 4321:4321 \
  -v /path/to/data:/app/data \
  --name file-tools \
  file-tools
```

### Docker Compose

```yaml
version: '3.8'
services:
  file-tools:
    build: .
    ports:
      - "4321:4321"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=4321
      - DATA_PATH=/app/data
    restart: unless-stopped
```

## Unraid Deployment

This container is compatible with Unraid 7.0.1 Docker.

### Configuration

1. Add container from Docker Hub or build locally
2. Set port mapping: Host `4321` → Container `4321`
3. Set volume mapping: Host path → `/app/data`
4. No privileged mode required
5. No additional configuration needed

### Template Settings

- **Network Type**: Bridge
- **Port**: 4321:4321
- **Volume**: /mnt/user/appdata/file-tools:/app/data

## API Endpoints

### GIF Conversion
- `POST /api/convert` - Upload and convert a GIF
- `GET /api/converted/:filename` - Download converted GIF

### File Sharing
- `POST /api/files/upload` - Upload a file for sharing
- `GET /api/files` - List all shared files
- `GET /api/files/:id` - Get file details
- `GET /api/files/:id/download` - Download shared file
- `DELETE /api/files/:id` - Delete a shared file

## File Retention

- All shared files are automatically deleted after their expiry time
- Maximum retention period: 24 hours
- Cleanup runs every minute via scheduled job
- File metadata persists across container restarts

## License

MIT
