"""fix_trigger_logic

Revision ID: 96f66f00b516
Revises: 44fe727e2b2a
Create Date: 2026-02-04 01:08:15.774858

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa



revision: str = "96f66f00b516"
down_revision: Union[str, Sequence[str], None] = "44fe727e2b2a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:

    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_product_url() RETURNS trigger AS $$
        BEGIN
            -- 1. Simply strip query params from the raw URL to keep it clean for the scraper
            NEW.url := split_part(NEW.url, '?', 1);

            -- 2. If the backend didn't provide a fingerprint, use the clean URL
            IF NEW.canonical_url IS NULL THEN
                NEW.canonical_url := NEW.url;
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """
    )


def downgrade() -> None:
    pass
