"""one customer profile for each phone, email, and name

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-21 23:40:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE customers
        SET phone = right(regexp_replace(phone, '\\D', '', 'g'), 10)
        WHERE phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') <> ''
        """
    )
    op.execute(
        """
        UPDATE customers
        SET phone = NULL
        WHERE phone IS NOT NULL AND phone !~ '^[0-9]{10}$'
        """
    )
    op.execute("UPDATE customers SET email = lower(btrim(email)) WHERE email IS NOT NULL")
    op.execute("UPDATE customers SET email = NULL WHERE email IS NOT NULL AND btrim(email) = ''")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION velura_merge_customer(keeper uuid, dup uuid) RETURNS void AS $$
        DECLARE
          taken uuid;
        BEGIN
          UPDATE appointments SET customer_id = keeper WHERE customer_id = dup;
          UPDATE invoices SET customer_id = keeper WHERE customer_id = dup;
          UPDATE customer_packages SET customer_id = keeper WHERE customer_id = dup;
          SELECT user_id INTO taken FROM customers WHERE id = dup;
          UPDATE customers SET user_id = NULL WHERE id = dup;
          UPDATE customers k SET
            phone = COALESCE(k.phone, d.phone),
            email = COALESCE(k.email, d.email),
            notes = COALESCE(k.notes, d.notes),
            allergies = COALESCE(k.allergies, d.allergies),
            preferences = COALESCE(k.preferences, d.preferences),
            date_of_birth = COALESCE(k.date_of_birth, d.date_of_birth),
            loyalty_points = COALESCE(k.loyalty_points, 0) + COALESCE(d.loyalty_points, 0)
          FROM customers d
          WHERE k.id = keeper AND d.id = dup;
          BEGIN
            UPDATE customers SET user_id = COALESCE(user_id, taken) WHERE id = keeper;
          EXCEPTION WHEN unique_violation THEN
            NULL;
          END;
          DELETE FROM customers WHERE id = dup;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        DO $$
        DECLARE
          rec record;
          keeper uuid;
          dup uuid;
        BEGIN
          FOR rec IN
            SELECT phone AS key FROM customers
            WHERE phone IS NOT NULL
            GROUP BY phone HAVING count(*) > 1
          LOOP
            SELECT id INTO keeper FROM customers WHERE phone = rec.key
            ORDER BY (user_id IS NULL), created_at, id LIMIT 1;
            FOR dup IN SELECT id FROM customers WHERE phone = rec.key AND id <> keeper LOOP
              PERFORM velura_merge_customer(keeper, dup);
            END LOOP;
          END LOOP;

          FOR rec IN
            SELECT lower(email) AS key FROM customers
            WHERE email IS NOT NULL
            GROUP BY lower(email) HAVING count(*) > 1
          LOOP
            SELECT id INTO keeper FROM customers WHERE lower(email) = rec.key
            ORDER BY (user_id IS NULL), created_at, id LIMIT 1;
            FOR dup IN SELECT id FROM customers WHERE lower(email) = rec.key AND id <> keeper LOOP
              PERFORM velura_merge_customer(keeper, dup);
            END LOOP;
          END LOOP;

          FOR rec IN
            SELECT lower(btrim(full_name)) AS key FROM customers
            WHERE btrim(full_name) <> ''
            GROUP BY lower(btrim(full_name)) HAVING count(*) > 1
          LOOP
            SELECT id INTO keeper FROM customers WHERE lower(btrim(full_name)) = rec.key
            ORDER BY (phone IS NULL), (email IS NULL), (user_id IS NULL), created_at, id LIMIT 1;
            FOR dup IN
              SELECT d.id
              FROM customers d
              JOIN customers k ON k.id = keeper
              WHERE lower(btrim(d.full_name)) = rec.key
                AND d.id <> keeper
                AND (d.phone IS NULL OR k.phone IS NULL OR d.phone = k.phone)
                AND (d.email IS NULL OR k.email IS NULL OR lower(d.email) = lower(k.email))
            LOOP
              PERFORM velura_merge_customer(keeper, dup);
            END LOOP;
          END LOOP;
        END $$;
        """
    )
    op.execute("DROP FUNCTION velura_merge_customer(uuid, uuid)")
    op.create_index(
        "uq_customers_phone",
        "customers",
        ["phone"],
        unique=True,
        postgresql_where=sa.text("phone IS NOT NULL"),
    )
    op.execute("CREATE UNIQUE INDEX uq_customers_email ON customers (lower(email)) WHERE email IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_customers_email")
    op.drop_index("uq_customers_phone", table_name="customers")
