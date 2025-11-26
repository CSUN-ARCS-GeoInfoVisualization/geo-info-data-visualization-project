"""Database connection management for wildfire prediction system.
Provides connection pooling and context managers for database operations.
"""

import psycopg2
from psycopg2 import pool
from contextlib import contextmanager
from config import DATABASE_URL, DB_NAME, LOG_QUERIES

# Connection pool (lazy initialization)
_connection_pool = None


def get_connection_pool(minconn=1, maxconn=10):
    """Get or create the connection pool."""
    global _connection_pool
    if _connection_pool is None:
        _connection_pool = psycopg2.pool.SimpleConnectionPool(
            minconn,
            maxconn,
            DATABASE_URL
        )
    return _connection_pool


@contextmanager
def get_db_connection():
    """Context manager for database connections.
    
    Usage:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM table")
                results = cur.fetchall()
    """
    pool = get_connection_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        pool.putconn(conn)


@contextmanager
def get_db_cursor(commit=True):
    """Context manager for database cursor.
    
    Usage:
        with get_db_cursor() as cur:
            cur.execute("SELECT * FROM table")
            results = cur.fetchall()
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        try:
            yield cursor
            if commit:
                conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            cursor.close()


def execute_sql_file(filepath, verbose=True):
    """Execute SQL commands from a file.
    
    Args:
        filepath: Path to SQL file
        verbose: Print execution progress
    
    Returns:
        True if successful, False otherwise
    """
    try:
        with open(filepath, 'r') as f:
            sql = f.read()
        
        if verbose:
            print(f"Executing SQL from: {filepath}")
        
        with get_db_cursor() as cur:
            cur.execute(sql)
        
        if verbose:
            print(f"✓ Successfully executed: {filepath}")
        return True
    
    except Exception as e:
        print(f"✗ Error executing {filepath}: {e}")
        return False


def test_connection():
    """Test database connection and PostGIS availability."""
    try:
        with get_db_cursor() as cur:
            # Test basic connection
            cur.execute("SELECT version();")
            pg_version = cur.fetchone()[0]
            print(f"✓ PostgreSQL connected: {pg_version}")
            
            # Test PostGIS
            cur.execute("SELECT PostGIS_Version();")
            postgis_version = cur.fetchone()[0]
            print(f"✓ PostGIS available: {postgis_version}")
            
            return True
    except Exception as e:
        print(f"✗ Connection test failed: {e}")
        return False


def close_connection_pool():
    """Close all connections in the pool."""
    global _connection_pool
    if _connection_pool is not None:
        _connection_pool.closeall()
        _connection_pool = None
        print("✓ Connection pool closed")
