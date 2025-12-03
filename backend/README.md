# Flask Auth Backend (SCRUM-30)

Implements registration with email, JWT auth, and role-based access (Resident/Researcher/Admin) with admin endpoints to manage user roles.

## Requirements
- Python 3.10+
- PostgreSQL 14+

## Setup
1. Create and activate a virtual env (PowerShell):
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```
2. Install dependencies:
```powershell
pip install -r requirements.txt
```
3. Configure environment:
```powershell
Copy-Item .env.example .env
# Edit .env with DB creds, SECRET_KEY, JWT_SECRET_KEY, and initial admin
```
4. Initialize DB and seed roles/admin:
```powershell
python seed.py
```
5. Run the server:
```powershell
python app.py
```
App will listen on http://localhost:5000

## API
- POST `/api/register`  Body: `{ email, password, role? }`
  - Allowed roles at signup: Resident (default) or Researcher. Admin is not allowed.
- POST `/api/login` Body: `{ email, password }` → `{ token }`
- GET `/api/me` (JWT required)

Admin-only (JWT role=Admin):
- GET `/api/admin/users`
- GET `/api/admin/users/:id`
- POST `/api/admin/assign-role` Body: `{ userId, role }`
  - Safeguard: Cannot demote the last remaining Admin.

## Notes
- Email uniqueness and validation are enforced.
- Passwords are hashed with bcrypt via passlib.
- Use DATABASE_URL format: `postgresql+psycopg2://user:pass@host:5432/dbname`.
