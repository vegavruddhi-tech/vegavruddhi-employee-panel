# 💼 Vegavruddhi Employee & TL Service Panel

A multi-application service suite housing field executive apps, Team Leader supervisor apps, REST API gateways, and an automated PDF document generation engine for **Vegavruddhi Technologies**.

---

## 🎯 1. Purpose of the Panel
The **Vegavruddhi Employee & TL Service Panel** is a unified multi-app suite. It contains the primary mobile web application used by Field Sales Executives (`employee-app`), the Team Leader application (`tl-app`), the backend API gateway (`api` & `backend`), and optimized PDF generation tools.

---

## 👥 2. Target Users & User Roles

| User Role | Target Audience | Primary Responsibilities | Access & Privileges |
| :--- | :--- | :--- | :--- |
| **Field Sales Executive (FSE)** | Ground Sales Agents | Submitting merchant onboarding forms, daily attendance, tracking personal earnings | Read/write access for personal forms, tasks, and attendance |
| **Team Leader (TL)** | Field Supervisors | Verifying merchant forms submitted by FSEs, tracking team productivity, inspecting salary slips | Read/verify access for assigned FSE team records |

---

## ✨ 3. Module & Directory Structure

```
vegavruddhi-employee-panel/
├── api/                      # Core REST API Controllers & Database Services
├── backend/                  # Node.js + Express API Gateway (Port 4000)
├── employee-app/             # FSE Mobile Application (React)
│   └── src/pages/
│       ├── Dashboard.js      # FSE Performance Dashboard & Target Counters
│       ├── MerchantForm.js   # Merchant Onboarding Input Wizard
│       ├── MerchantDetail.js # Submitted Form Inspection View
│       ├── Tasks.js          # Field Task Management
│       ├── MySalary.js       # Salary Slip Viewer & Incentive Calculation
│       ├── Profile.js        # Agent Profile & User Details
│       ├── Login.js          # User Login Form
│       └── Register.js       # Agent Account Registration
├── tl-app/                   # Team Leader Application (React)
├── PUPPETEER_TO_PDFKIT_MIGRATION.md # Architecture documentation on PDFKit engine
└── MIGRATION_COMPLETED.md    # System migration completion audit
```

---

## 📑 4. Detailed Features & Functionalities

### 📱 FSE Mobile Application (`employee-app`)
- **FSE Dashboard (`Dashboard.js`)**: Real-time counter of total onboarded merchants today, target progression bar, monthly incentive calculation, and quick action cards.
- **Merchant Onboarding Wizard (`MerchantForm.js`)**: Comprehensive multi-step merchant registration form capturing store name, owner name, contact number, bank details, PAN/Aadhaar number, and store front images.
- **Merchant Form Inspection (`MerchantDetail.js`)**: View submitted application status, verification history, and TL feedback notes.
- **Field Task Manager (`Tasks.js`)**: Inspect assigned daily merchant visit tasks, update task status (Pending, Completed, In Progress), and view supervisor instructions.
- **Salary Slip & Incentive Portal (`MySalary.js`)**: Inspect monthly earnings breakdown, base pay, approved points, target bonuses, and download PDF payslips.

### 📄 High-Performance PDF Generation Engine (PDFKit Migration)
- Replaced headless Chrome / Puppeteer with lightweight **PDFKit** engine for generating merchant receipts, verification documents, and salary slips.
- Reduced memory consumption by over **80%** and improved PDF generation response times from seconds to milliseconds.
- Fully documented in [`PUPPETEER_TO_PDFKIT_MIGRATION.md`](file:///c:/VegaProject/vegavruddhi-employee-panel/PUPPETEER_TO_PDFKIT_MIGRATION.md).

---

## 🔄 5. Complete End-to-End Workflow

```
[ FSE Field Onboarding ] ──► [ API Gateway (`backend`) ] ──► [ TL Audit (`tl-app`) ]
           │                                                        │
           ▼                                                        ▼
[ Store Data in MongoDB ] ◄────────────────────────────────[ Approve / Reject ]
           │
           ▼
[ PDFKit Generates Receipt ] ──► [ Forward to Admin & Salary Engine ]
```

1. **Agent Registration**: FSE registers on `employee-app` via `Register.js`, which is approved by Admin/TL.
2. **Onboarding Submission**: FSE completes merchant details on `MerchantForm.js` and submits the application to the `backend` API.
3. **TL Inspection**: Application appears on Team Leader app (`tl-app`) for document verification and status update.
4. **PDF Receipt & Payslip**: Once verified, PDFKit generates merchant confirmation PDFs and updates the FSE's salary points on `MySalary.js`.

---

## ⚡ 6. Key Actions & Operations

- **Submit Merchant Applications**: Register new merchants with store details, photo proof, and banking information.
- **Update Task Progress**: Complete assigned field visit goals and log notes.
- **Track Earnings & Payslips**: View real-time point rewards and download salary slips.
- **Generate Instant PDF Receipts**: Produce PDF documentation using the fast PDFKit backend engine.

---

## 🔗 7. Cross-Panel Connections & Integrations

- ⬆️ **Admin Panel (`vegavruddhi-admin-panel`)**: Syncs employee registrations, verification status, and master database entries.
- ⬆️ **Manager Panel (`Manager_Panel`)**: Feeds overall onboarding counts into manager target dashboards.

---

## 🛠️ 8. Tech Stack & Environment Setup

- **Frontend Applications**: React 19 (`employee-app`, `tl-app`), Material-UI, Emotion
- **Backend API**: Express.js 4, Mongoose 7, PDFKit, JWT, bcryptjs

### Startup Instructions
```bash
# 1. Start Backend Server
cd c:\VegaProject\vegavruddhi-employee-panel\backend
npm install
npm start

# 2. Start FSE Employee Application
cd c:\VegaProject\vegavruddhi-employee-panel\employee-app
npm install
npm start
```

---

## 📄 License
Internal Proprietary Software – Vegavruddhi Technologies. All Rights Reserved.
