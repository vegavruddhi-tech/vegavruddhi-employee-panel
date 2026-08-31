# 💼 Vegavruddhi Employee & TL Service Panel

Comprehensive multi-app service suite containing employee field applications, Team Leader (TL) management interfaces, standalone APIs, and automated PDF export utilities.

---

## 📐 Architecture & Service Modules

```
vegavruddhi-employee-panel/
├── api/              # Core API gateway & business logic modules
├── backend/          # Node.js + Express backend server
├── employee-app/     # FSE Mobile Application (React)
├── tl-app/           # Team Leader Application (React)
└── backup_test3/     # Historical testing & fallback configurations
```

---

## ✨ Key Features

- 📱 **Employee App (`employee-app`)**: Mobile field interface for agent attendance, merchant onboarding, and visit reports.
- 👔 **TL App (`tl-app`)**: Team Leader supervisor portal for live team metrics and submission verification.
- 📄 **PDFKit Document Engine**: Fast, dependency-free client/server PDF generation engine (migrated from Puppeteer for optimized performance).
- 🔌 **Unified API Layer (`api` & `backend`)**: Restful API handlers backing both mobile and desktop views.

---

## 🚀 Quick Start Guide

### 1. Backend & API Services
```bash
cd backend
npm install
npm start
```

### 2. Employee Mobile App
```bash
cd employee-app
npm install
npm start
```

### 3. Team Leader App
```bash
cd tl-app
npm install
npm start
```

---

## 📄 Documentation & Migrations
- 📌 [`PUPPETEER_TO_PDFKIT_MIGRATION.md`](file:///c:/VegaProject/vegavruddhi-employee-panel/PUPPETEER_TO_PDFKIT_MIGRATION.md) – Architectural guide on PDF performance optimization.
- 📌 [`MIGRATION_COMPLETED.md`](file:///c:/VegaProject/vegavruddhi-employee-panel/MIGRATION_COMPLETED.md) – Log of completed technical migrations and system enhancements.

---

## 📄 License
Internal Proprietary Software – Vegavruddhi Technologies.
