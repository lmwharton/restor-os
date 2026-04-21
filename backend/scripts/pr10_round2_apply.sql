-- =============================================================================
-- PR #10 Round-2 fixes — manual installation script.
--
-- What this is: the SQL bodies of four Alembic migrations that live on the
-- feature/01h-floor-plan-v2-phase1 branch and can't be applied via
-- `alembic upgrade head` on a dev DB that sits on the moisture-pins branch's
-- head (revision divergence). Every statement is idempotent, so pasting
-- this whole file into Supabase SQL Editor is safe to re-run.
--
-- Apply this BEFORE testing the round-2 backend changes locally. Without it:
--   - R9's router refactor calls ensure_job_property(p_job_id) — 404 otherwise.
--   - R3/R4/R10 are additive hardening; old behavior keeps working without
--     them, but you won't have the new protections.
--
-- Chain order: R3 → R4-trigger → R9 → R10. Run top-to-bottom.
--
-- Covered migrations (for traceability when rebasing):
--   c7f8a9b0d1e2  R3  save_floor_plan_version tenant hardening
--   d8e9f0a1b2c3  R4  floor_plans frozen-mutation trigger
--   e9f0a1b2c3d4  R9  ensure_job_property RPC + address unique index
--   f0a1b2c3d4e5  R10 wall/opening RLS parent-ownership
-- =============================================================================


-- -----------------------------------------------------------------------------
-- R3 (c7f8a9b0d1e2): save_floor_plan_version — JWT-derived tenant check,
-- property ownership, job-on-property check, pinned search_path.
-- CREATE OR REPLACE is idempotent.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION save_floor_plan_version(
    p_property_id   UUID,
    p_floor_number  INTEGER,
    p_floor_name    TEXT,
    p_company_id    UUID,
    p_job_id        UUID,
    p_user_id       UUID,
    p_canvas_data   JSONB,
    p_change_summary TEXT
) RETURNS JSONB AS $$
DECLARE
    v_next_number     INTEGER;
    v_inherited_name  TEXT;
    v_new_row         floor_plans%ROWTYPE;
    v_caller_company  UUID;
BEGIN
    IF p_job_id IS NULL OR p_company_id IS NULL OR p_property_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id, p_company_id, and p_property_id are required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company (unauthenticated or user not linked)';
    END IF;
    IF v_caller_company <> p_company_id THEN
        RAISE EXCEPTION 'Company mismatch'
              USING ERRCODE = '42501',
                    MESSAGE = 'p_company_id does not match the authenticated caller company';
    END IF;

    PERFORM 1
      FROM properties
     WHERE id = p_property_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Property not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Property not found or does not belong to the caller company';
    END IF;

    PERFORM 1
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND property_id = p_property_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not found on this property'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or does not belong to this property';
    END IF;

    SELECT version_number + 1,
           COALESCE(p_floor_name, floor_name)
      INTO v_next_number, v_inherited_name
      FROM floor_plans
     WHERE property_id  = p_property_id
       AND floor_number = p_floor_number
     ORDER BY version_number DESC
     LIMIT 1;

    IF v_next_number IS NULL THEN
        v_next_number    := 1;
        v_inherited_name := COALESCE(p_floor_name,
                                     'Floor ' || p_floor_number::TEXT);
    END IF;

    UPDATE floor_plans
       SET is_current = false
     WHERE property_id  = p_property_id
       AND floor_number = p_floor_number
       AND is_current   = true;

    INSERT INTO floor_plans (
        property_id, company_id, floor_number, floor_name,
        version_number, canvas_data, created_by_job_id, created_by_user_id,
        change_summary, is_current
    ) VALUES (
        p_property_id, p_company_id, p_floor_number, v_inherited_name,
        v_next_number, p_canvas_data, p_job_id, p_user_id,
        p_change_summary, true
    )
    RETURNING * INTO v_new_row;

    UPDATE jobs
       SET floor_plan_id = v_new_row.id
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    RETURN to_jsonb(v_new_row);
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION save_floor_plan_version(UUID, INTEGER, TEXT, UUID, UUID, UUID, JSONB, TEXT)
    TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- R4 belt-and-suspenders (d8e9f0a1b2c3): DB-level frozen-row immutability.
-- DROP TRIGGER IF EXISTS makes this re-runnable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION floor_plans_prevent_frozen_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_current IS FALSE THEN
        RAISE EXCEPTION 'floor_plans version is frozen (is_current=false)'
              USING ERRCODE = '42501',
                    MESSAGE = 'Cannot mutate a frozen floor_plans version. Create a new version via save_floor_plan_version instead.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS trg_floor_plans_prevent_frozen_mutation ON floor_plans;
CREATE TRIGGER trg_floor_plans_prevent_frozen_mutation
    BEFORE UPDATE ON floor_plans
    FOR EACH ROW
    EXECUTE FUNCTION floor_plans_prevent_frozen_mutation();


-- -----------------------------------------------------------------------------
-- R9 (e9f0a1b2c3d4): partial unique address index + ensure_job_property RPC.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_address_active
    ON properties (
        company_id,
        lower(btrim(address_line1)),
        lower(btrim(city)),
        state,
        btrim(zip)
    )
    WHERE deleted_at IS NULL;


CREATE OR REPLACE FUNCTION ensure_job_property(
    p_job_id UUID
) RETURNS UUID AS $$
DECLARE
    v_caller_company UUID;
    v_job            RECORD;
    v_property_id    UUID;
BEGIN
    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_job_id is required';
    END IF;

    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;

    -- jobs only has address_line1 (no address_line2); properties carries both,
    -- so the INSERT below leaves address_line2 NULL for auto-linked rows.
    SELECT id, property_id, address_line1,
           city, state, zip, latitude, longitude, company_id, deleted_at
      INTO v_job
      FROM jobs
     WHERE id = p_job_id
       AND company_id = v_caller_company
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Job not found or does not belong to the caller company';
    END IF;

    IF v_job.property_id IS NOT NULL THEN
        RETURN v_job.property_id;
    END IF;

    SELECT id INTO v_property_id
      FROM properties
     WHERE company_id = v_caller_company
       AND lower(btrim(address_line1)) = lower(btrim(v_job.address_line1))
       AND lower(btrim(city))          = lower(btrim(v_job.city))
       AND state                        = v_job.state
       AND btrim(zip)                  = btrim(v_job.zip)
       AND deleted_at IS NULL
     LIMIT 1;

    IF v_property_id IS NULL THEN
        INSERT INTO properties (
            company_id, address_line1, city, state, zip,
            latitude, longitude
        ) VALUES (
            v_caller_company, v_job.address_line1,
            v_job.city, v_job.state, v_job.zip,
            v_job.latitude, v_job.longitude
        )
        RETURNING id INTO v_property_id;
    END IF;

    UPDATE jobs
       SET property_id = v_property_id
     WHERE id = p_job_id
       AND company_id = v_caller_company;

    RETURN v_property_id;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION ensure_job_property(UUID) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- R10 (f0a1b2c3d4e5): wall/opening RLS parent-ownership check.
-- DROP POLICY IF EXISTS makes this re-runnable.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS walls_insert ON wall_segments;
CREATE POLICY walls_insert ON wall_segments
    FOR INSERT WITH CHECK (
        company_id = get_my_company_id()
        AND EXISTS (
            SELECT 1 FROM job_rooms jr
             WHERE jr.id = wall_segments.room_id
               AND jr.company_id = get_my_company_id()
        )
    );

DROP POLICY IF EXISTS walls_update ON wall_segments;
CREATE POLICY walls_update ON wall_segments
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (
        company_id = get_my_company_id()
        AND EXISTS (
            SELECT 1 FROM job_rooms jr
             WHERE jr.id = wall_segments.room_id
               AND jr.company_id = get_my_company_id()
        )
    );

DROP POLICY IF EXISTS openings_insert ON wall_openings;
CREATE POLICY openings_insert ON wall_openings
    FOR INSERT WITH CHECK (
        company_id = get_my_company_id()
        AND EXISTS (
            SELECT 1 FROM wall_segments ws
             WHERE ws.id = wall_openings.wall_id
               AND ws.company_id = get_my_company_id()
        )
    );

DROP POLICY IF EXISTS openings_update ON wall_openings;
CREATE POLICY openings_update ON wall_openings
    FOR UPDATE USING (company_id = get_my_company_id())
    WITH CHECK (
        company_id = get_my_company_id()
        AND EXISTS (
            SELECT 1 FROM wall_segments ws
             WHERE ws.id = wall_openings.wall_id
               AND ws.company_id = get_my_company_id()
        )
    );


-- -----------------------------------------------------------------------------
-- R13 (a1b2c3d4e5f7): drop redundant non-unique idx_floor_plans_is_current.
-- Shadowed by idx_floor_plans_current_unique (same columns + predicate + UNIQUE).
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_floor_plans_is_current;


-- -----------------------------------------------------------------------------
-- R17 (c3d4e5f8a9b0): non-negative CHECK on wall SF columns. Guarded with
-- EXISTS so re-runs don't error.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'custom_wall_sf_nonneg' AND conrelid = 'job_rooms'::regclass
    ) THEN
        ALTER TABLE job_rooms
            ADD CONSTRAINT custom_wall_sf_nonneg
                CHECK (custom_wall_sf IS NULL OR custom_wall_sf >= 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'wall_square_footage_nonneg' AND conrelid = 'job_rooms'::regclass
    ) THEN
        ALTER TABLE job_rooms
            ADD CONSTRAINT wall_square_footage_nonneg
                CHECK (wall_square_footage IS NULL OR wall_square_footage >= 0);
    END IF;
END $$;


-- -----------------------------------------------------------------------------
-- R14 (b2c3d4e5f8a9): rename versions_* policies to floor_plans_* on the
-- renamed table. Guarded with EXISTS so re-runs don't error.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'versions_select') THEN
        EXECUTE 'ALTER POLICY versions_select ON floor_plans RENAME TO floor_plans_select';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'versions_insert') THEN
        EXECUTE 'ALTER POLICY versions_insert ON floor_plans RENAME TO floor_plans_insert';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'versions_update') THEN
        EXECUTE 'ALTER POLICY versions_update ON floor_plans RENAME TO floor_plans_update';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'floor_plans' AND policyname = 'versions_delete') THEN
        EXECUTE 'ALTER POLICY versions_delete ON floor_plans RENAME TO floor_plans_delete';
    END IF;
END $$;


-- -----------------------------------------------------------------------------
-- R18 (d4e5f8a9b0c1): document the swing column mapping so \d+ wall_openings
-- in psql shows what each of 0/1/2/3 means.
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN wall_openings.swing IS
    'Door hinge + swing quadrant. 0=hinge-left-swing-up, 1=hinge-left-swing-down, '
    '2=hinge-right-swing-down, 3=hinge-right-swing-up. Cycles on re-tap via (swing+1)%4. '
    'Source of truth: FloorOpeningData.swing in web/src/components/sketch/floor-plan-tools.ts. '
    'NULL for windows / missing walls (doors only).';


-- -----------------------------------------------------------------------------
-- R19 (e5f8a9b0c1d2): restore_floor_plan_relational_snapshot RPC.
-- Reads canvas_data._relational_snapshot from a rollback version row and
-- applies it atomically to wall_segments / wall_openings / job_rooms JSONB
-- columns. CREATE OR REPLACE is idempotent.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION restore_floor_plan_relational_snapshot(
    p_new_floor_plan_id UUID
) RETURNS JSONB AS $$
DECLARE
    v_caller_company   UUID;
    v_canvas           JSONB;
    v_snapshot         JSONB;
    v_snapshot_version INTEGER;
    v_room_count       INTEGER := 0;
    v_wall_count       INTEGER := 0;
    v_opening_count    INTEGER := 0;
    v_room_jsonb       JSONB;
    v_room_id          UUID;
    v_wall_jsonb       JSONB;
    v_new_wall_id      UUID;
    v_opening_jsonb    JSONB;
BEGIN
    IF p_new_floor_plan_id IS NULL THEN
        RAISE EXCEPTION 'Required parameter is NULL'
              USING ERRCODE = '22023',
                    MESSAGE = 'p_new_floor_plan_id is required';
    END IF;
    v_caller_company := get_my_company_id();
    IF v_caller_company IS NULL THEN
        RAISE EXCEPTION 'No authenticated company'
              USING ERRCODE = '42501',
                    MESSAGE = 'JWT did not resolve to a company';
    END IF;
    SELECT canvas_data INTO v_canvas
      FROM floor_plans
     WHERE id = p_new_floor_plan_id
       AND company_id = v_caller_company;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Floor plan not accessible'
              USING ERRCODE = 'P0002',
                    MESSAGE = 'Rollback version not found or belongs to another company';
    END IF;
    v_snapshot := v_canvas -> '_relational_snapshot';
    IF v_snapshot IS NULL OR jsonb_typeof(v_snapshot) <> 'object' THEN
        RETURN jsonb_build_object('restored', false, 'reason', 'no_snapshot',
                                  'rooms', 0, 'walls', 0, 'openings', 0);
    END IF;
    v_snapshot_version := COALESCE((v_snapshot ->> 'version')::INTEGER, 0);
    IF v_snapshot_version <> 1 THEN
        RAISE EXCEPTION 'Unsupported snapshot version: %', v_snapshot_version
              USING ERRCODE = '22023';
    END IF;
    FOR v_room_jsonb IN SELECT * FROM jsonb_array_elements(v_snapshot -> 'rooms') LOOP
        v_room_id := (v_room_jsonb ->> 'id')::UUID;
        PERFORM 1 FROM job_rooms WHERE id = v_room_id AND company_id = v_caller_company;
        IF NOT FOUND THEN CONTINUE; END IF;
        UPDATE job_rooms
           SET room_polygon   = v_room_jsonb -> 'room_polygon',
               floor_openings = COALESCE(v_room_jsonb -> 'floor_openings', '[]'::jsonb)
         WHERE id = v_room_id AND company_id = v_caller_company;
        DELETE FROM wall_segments WHERE room_id = v_room_id AND company_id = v_caller_company;
        v_room_count := v_room_count + 1;
        FOR v_wall_jsonb IN SELECT * FROM jsonb_array_elements(COALESCE(v_room_jsonb -> 'walls', '[]'::jsonb)) LOOP
            INSERT INTO wall_segments (
                room_id, company_id, x1, y1, x2, y2,
                wall_type, wall_height_ft, affected, shared, shared_with_room_id, sort_order
            ) VALUES (
                v_room_id, v_caller_company,
                (v_wall_jsonb ->> 'x1')::DECIMAL, (v_wall_jsonb ->> 'y1')::DECIMAL,
                (v_wall_jsonb ->> 'x2')::DECIMAL, (v_wall_jsonb ->> 'y2')::DECIMAL,
                COALESCE(v_wall_jsonb ->> 'wall_type', 'interior'),
                NULLIF(v_wall_jsonb ->> 'wall_height_ft', '')::DECIMAL,
                COALESCE((v_wall_jsonb ->> 'affected')::BOOLEAN, false),
                COALESCE((v_wall_jsonb ->> 'shared')::BOOLEAN, false),
                NULLIF(v_wall_jsonb ->> 'shared_with_room_id', '')::UUID,
                COALESCE((v_wall_jsonb ->> 'sort_order')::INTEGER, 0)
            ) RETURNING id INTO v_new_wall_id;
            v_wall_count := v_wall_count + 1;
            FOR v_opening_jsonb IN SELECT * FROM jsonb_array_elements(COALESCE(v_wall_jsonb -> '_openings', '[]'::jsonb)) LOOP
                INSERT INTO wall_openings (
                    wall_id, company_id, opening_type, position,
                    width_ft, height_ft, sill_height_ft, swing
                ) VALUES (
                    v_new_wall_id, v_caller_company,
                    v_opening_jsonb ->> 'opening_type',
                    (v_opening_jsonb ->> 'position')::DECIMAL,
                    (v_opening_jsonb ->> 'width_ft')::DECIMAL,
                    (v_opening_jsonb ->> 'height_ft')::DECIMAL,
                    NULLIF(v_opening_jsonb ->> 'sill_height_ft', '')::DECIMAL,
                    NULLIF(v_opening_jsonb ->> 'swing', '')::INTEGER
                );
                v_opening_count := v_opening_count + 1;
            END LOOP;
        END LOOP;
    END LOOP;
    RETURN jsonb_build_object('restored', true, 'rooms', v_room_count,
                              'walls', v_wall_count, 'openings', v_opening_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

GRANT EXECUTE ON FUNCTION restore_floor_plan_relational_snapshot(UUID) TO authenticated, service_role;


-- =============================================================================
-- Verify (optional). Should return one row each.
-- =============================================================================
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('save_floor_plan_version', 'ensure_job_property', 'floor_plans_prevent_frozen_mutation');
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_floor_plans_prevent_frozen_mutation';
--   SELECT indexname FROM pg_indexes WHERE indexname = 'idx_properties_address_active';
--   SELECT policyname FROM pg_policies
--     WHERE tablename IN ('wall_segments', 'wall_openings')
--       AND policyname IN ('walls_insert', 'walls_update', 'openings_insert', 'openings_update');
