"""enforce_fingerprint_logic

Revision ID: cbcf962ada23
Revises: 96f66f00b516
Create Date: 2026-02-04 01:38:50.515683

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa



revision: str = "cbcf962ada23"
down_revision: Union[str, Sequence[str], None] = "96f66f00b516"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:


    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_product_url() RETURNS trigger AS $$
        BEGIN
            -- Clean the URL: Remove anything after '?'
            NEW.url := split_part(NEW.url, '?', 1);

            -- Set the fingerprint for the UNIQUE constraint
            NEW.canonical_url := NEW.url;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Apply the trigger
        DROP TRIGGER IF EXISTS check_product_url_format ON tracked_products;
        CREATE TRIGGER check_product_url_format
        BEFORE INSERT OR UPDATE ON tracked_products
        FOR EACH ROW EXECUTE FUNCTION validate_product_url();
    """
    )


def downgrade() -> None:
    """Downgrade schema."""
    pass
