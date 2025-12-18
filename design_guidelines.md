# Design Guidelines: File Conversion & Sharing Tool

## Design Approach
**Selected System**: Material Design 3 with productivity tool refinements
**Rationale**: Utility-focused application requiring clarity, efficiency, and trust. Users need clear feedback and streamlined workflows for file operations.

## Typography System

**Font Family**: Inter (via Google Fonts CDN)
- Primary UI: Inter 400, 500, 600
- Monospace (file sizes, dimensions): JetBrains Mono 400

**Type Scale**:
- Page Title: text-2xl font-semibold (tabs header)
- Section Headers: text-lg font-medium
- Body Text: text-base font-normal
- Labels: text-sm font-medium
- Helper Text: text-sm font-normal
- Metadata (file info): text-xs font-mono

## Layout System

**Spacing Primitives**: Tailwind units of 2, 4, 6, 8, 12, 16
- Component padding: p-6
- Section gaps: gap-8
- Input spacing: space-y-4
- Button padding: px-6 py-3

**Container Structure**:
- Max width: max-w-4xl mx-auto
- Page padding: px-6 py-8
- Content cards: rounded-lg with subtle elevation

## Component Library

### Navigation Tabs
- Horizontal tab bar at top
- Full-width tabs with centered labels
- Active tab: subtle bottom border indicator
- Text: text-base font-medium
- Spacing: py-4 with gap-8 between tabs

### Upload Zones
**Image Converter**:
- Dashed border upload area (min-h-48)
- Center-aligned icon (Heroicons: ArrowUpTray, 24px)
- Primary text: "Drop GIF here or click to browse"
- Constraint text below: "Animated GIF only, max 10MB"
- Hover state with subtle background shift

**File Sharing**:
- Similar upload zone structure
- Text: "Upload any file"
- Shows file type acceptance message

### Mode Selection (Image Tab)
**Radio Button Group**:
- Vertical stack with space-y-3
- Each option: rounded container with p-4
- Selected state: prominent border treatment
- Label hierarchy: main option (font-medium) + description (text-sm)

**Yalla Ludo Option**:
- Title + badge showing "2MB · 180×180px"
- No expansion panel needed

**Custom Option**:
- Reveals 3 input fields below when selected
- Grid: grid-cols-3 gap-4 for inputs
- Each input: label above, number input with unit suffix

### Form Inputs
**Number Inputs**:
- Clear labels with units (MB, px)
- Standard input styling with border
- Focus state with border emphasis
- Right-aligned text for numerical values

**Time Selection (File Sharing)**:
- Dropdown or slider for expiry duration
- Default: 24 hours prominently shown
- Visual countdown display post-upload

### Output Display Cards
**Conversion Results**:
- Card container with rounded-lg p-6
- Grid layout: 2 columns (preview | metadata)
- Animated preview: max-w-xs, centered
- Metadata stack:
  - Original vs Final comparison table
  - File size with visual indicator (progress bar if compressed)
  - Dimensions display
  - Frame count preservation indicator

**File Sharing Results**:
- Generated link in copyable input field (text-sm font-mono)
- Copy button integrated (Heroicons: DocumentDuplicate)
- Expiry countdown: large, prominent (text-3xl font-semibold)
- Time remaining in hours:minutes format

### Buttons
**Primary Actions** (Convert, Upload, Download):
- px-6 py-3 rounded-md
- text-base font-medium
- Disabled state: reduced opacity with cursor-not-allowed

**Secondary Actions** (Delete, Cancel):
- Ghost style with border
- Same padding structure

**Icon Buttons** (Copy link):
- Square aspect (p-3)
- Icon only with tooltip on hover

### Status Indicators
**Processing States**:
- Inline spinner (Heroicons: ArrowPath with spin animation)
- Progress bar for lengthy operations
- Text status: "Converting..." / "Uploading..."

**Success/Error Messages**:
- Alert boxes with rounded-md p-4
- Icons: CheckCircle (success), ExclamationTriangle (error)
- Dismissible with X button

**Validation Messages**:
- Inline below inputs
- text-sm in attention-drawing treatment
- Icon prefix for quick scanning

### Data Display
**File Information Grid**:
- 2-column layout for property-value pairs
- Labels: text-sm font-medium
- Values: text-base font-mono (for numbers)
- Divider lines between rows

**Comparison Table** (before/after):
- Simple 2-column table structure
- Header row with Before | After
- Aligned columns for easy scanning

## Icons
**Library**: Heroicons (outline style via CDN)
**Usage**:
- Upload: ArrowUpTray
- Download: ArrowDownTray  
- Delete: Trash
- Copy: DocumentDuplicate
- Success: CheckCircle
- Error: ExclamationTriangle
- Processing: ArrowPath (animated)
- Info: InformationCircle

## Animation Guidelines
**Minimal Use Only**:
- Tab switching: instant, no transition
- File upload progress: smooth progress bar
- Processing spinner: standard rotation
- Success confirmation: subtle scale-in (0.98 → 1.0)
- NO decorative animations

## Accessibility
- All form inputs with associated labels
- Focus indicators on all interactive elements
- ARIA labels for icon-only buttons
- Error messages programmatically associated with inputs
- Keyboard navigation for tab switching
- Screen reader announcements for async operations

## Images
**No hero image** - utility tool doesn't require one
**Visual Feedback Images**:
- Animated GIF preview shown full-size in results
- Empty state illustrations in upload zones (simple iconography)