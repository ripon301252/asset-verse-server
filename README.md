# AssetVerse Backend API

AssetVerse is a **Corporate Asset Management System backend** developed using **Node.js, Express, MongoDB, and Stripe**. It allows HR and Employees to manage company assets efficiently through asset requests, approvals, returns, and package-based employee limits.

---

## Technologies

* Node.js
* Express.js
* MongoDB (Atlas)
* Stripe Payment Gateway
* dotenv, CORS

---

## Environment Setup

Create a `.env` file with the following variables:

```
PORT=3000
DB_USER=your_db_user
DB_PASS=your_db_password
STRIPE_SECRET=your_stripe_secret_key
CLIENT_URL=http://localhost:5173
HR_SECRET_CODE=your_hr_secret
```

---

## Run the Server

```bash
npm install
node index.js
```

Server URL:

```
http://localhost:3000
```

---

## Core Features

* Role-based user system (HR / Employee)
* Secure HR registration using secret code
* Asset CRUD operations
* Asset request, approval, rejection, and return
* Automatic employee-company affiliation
* Package-based employee limits
* Stripe payment integration for package upgrades
* Dashboard data for charts

---

## Project Purpose

This backend was built as an **assignment project** to demonstrate real-world backend development skills including REST API design, database relations, authentication logic, and payment integration.

---

**AssetVerse Backend – Assignment Submission**
