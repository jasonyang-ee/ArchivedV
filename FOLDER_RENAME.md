# Folder Rename: client → src

## Summary

Successfully updated all references from `client/` folder to `src/` folder.

## Files Updated

### 1. ✅ `index.html`
Already updated by user:
```html
<script type="module" src="/src/main.jsx"></script>
```

### 2. ✅ `tailwind.config.js`
Updated content path:
```javascript
content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"]
```
**Was:** `./client/**/*.{js,ts,jsx,tsx}`

### 3. ✅ `vite.config.js`
Fixed and updated API proxy target:
```javascript
proxy: {
  "/api": {
    target: "http://localhost:3500",
    changeOrigin: true,
  },
}
```

### 4. ✅ `src/api.js`
Fixed API base URL:
```javascript
const API_BASE = import.meta.env.PROD ? "/api" : "http://localhost:3500/api";
```

### 5. ✅ `server/index.js`
Updated default port:
```javascript
const PORT = process.env.PORT || 3500;
```

## Port Configuration

Changed from conflicting ports to port **3500**:
- **Backend Server:** http://localhost:3500
- **Frontend Dev:** http://localhost:5173 (or 5174 if 5173 is busy)

## Verification

All folder references have been updated:
- ✅ No remaining `client/` references in code
- ✅ Tailwind will scan `src/**/*.{js,ts,jsx,tsx}`
- ✅ Vite serves from `src/` directory
- ✅ API calls proxy to port 3500

## Notes

- The `client:dev` script name in `package.json` is unchanged (it's just a name, not a folder reference)
- React's `react-dom/client` import is correct (it's a React package, not our folder)
- Build output directory remains `dist/`

## Next Steps

To start the development server:
```bash
npm run dev
```

This will start:
- Backend on http://localhost:3500
- Frontend on http://localhost:5173

All references are now correctly pointing to the `src/` folder! 🎉
