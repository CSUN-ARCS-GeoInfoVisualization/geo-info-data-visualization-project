import os
from dotenv import load_dotenv
from flask import Flask
from config import Config
from models import db, Role, User
from app import create_app

load_dotenv()

app = create_app(Config)

with app.app_context():
    db.create_all()
    # Ensure roles
    for name in ['Resident', 'Researcher', 'Admin']:
        if not Role.query.filter_by(name=name).first():
            db.session.add(Role(name=name))
    db.session.commit()

    email = app.config.get('INITIAL_ADMIN_EMAIL')
    pwd = app.config.get('INITIAL_ADMIN_PASSWORD')
    if not email or not pwd:
        print('INITIAL_ADMIN_EMAIL or INITIAL_ADMIN_PASSWORD not set. Skipping admin creation.')
    else:
        admin_role = Role.query.filter_by(name='Admin').first()
        existing = User.query.filter_by(email=email).first()
        if existing:
            print('Admin user already exists, skipping.')
        else:
            user = User(email=email, password_hash=User.hash_password(pwd), role_id=admin_role.id)
            db.session.add(user)
            db.session.commit()
            print('Initial admin user created:', email)
