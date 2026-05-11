// @generated — DO NOT EDIT.
// Source: scripts/vendor-eql-install.ts
// Bundle pinned version: eql-2.2.1
//
// This file is committed to source control so dev environments and
// offline builds work without network access. Regenerate with
// `pnpm vendor-eql-install` after bumping EQL_VERSION in the script.

export const EQL_INSTALL_VERSION = 'eql-2.2.1' as const;

export const EQL_INSTALL_SQL: string = `--! @file schema.sql
--! @brief EQL v2 schema creation
--!
--! Creates the eql_v2 schema which contains all Encrypt Query Language
--! functions, types, and tables. Drops existing schema if present to
--! support clean reinstallation.
--!
--! @warning DROP SCHEMA CASCADE will remove all objects in the schema
--! @note All EQL objects (functions, types, tables) reside in eql_v2 schema

--! @brief Drop existing EQL v2 schema
--! @warning CASCADE will drop all dependent objects
DROP SCHEMA IF EXISTS eql_v2 CASCADE;

--! @brief Create EQL v2 schema
--! @note All EQL functions and types will be created in this schema
CREATE SCHEMA eql_v2;

--! @brief Composite type for encrypted column data
--!
--! Core type used for all encrypted columns in EQL. Stores encrypted data as JSONB
--! with the following structure:
--! - \`c\`: ciphertext (base64-encoded encrypted value)
--! - \`i\`: index terms (searchable metadata for encrypted searches)
--! - \`k\`: key ID (identifier for encryption key)
--! - \`m\`: metadata (additional encryption metadata)
--!
--! Created in public schema to persist independently of eql_v2 schema lifecycle.
--! Customer data columns use this type, so it must not be dropped if data exists.
--!
--! @note DO NOT DROP this type unless absolutely certain no encrypted data uses it
--! @see eql_v2.ciphertext
--! @see eql_v2.meta_data
--! @see eql_v2.add_column
DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eql_v2_encrypted') THEN
      CREATE TYPE public.eql_v2_encrypted AS (
        data jsonb
      );
    END IF;
  END
$$;










--! @brief Bloom filter index term type
--!
--! Domain type representing Bloom filter bit arrays stored as smallint arrays.
--! Used for pattern-match encrypted searches via the 'match' index type.
--! The filter is stored in the 'bf' field of encrypted data payloads.
--!
--! @see eql_v2.add_search_config
--! @see eql_v2."~~"
--! @note This is a transient type used only during query execution
CREATE DOMAIN eql_v2.bloom_filter AS smallint[];



--! @brief ORE block term type for Order-Revealing Encryption
--!
--! Composite type representing a single ORE (Order-Revealing Encryption) block term.
--! Stores encrypted data as bytea that enables range comparisons without decryption.
--!
--! @see eql_v2.ore_block_u64_8_256
--! @see eql_v2.compare_ore_block_u64_8_256_term
CREATE TYPE eql_v2.ore_block_u64_8_256_term AS (
  bytes bytea
);


--! @brief ORE block index term type for range queries
--!
--! Composite type containing an array of ORE block terms. Used for encrypted
--! range queries via the 'ore' index type. The array is stored in the 'ob' field
--! of encrypted data payloads.
--!
--! @see eql_v2.add_search_config
--! @see eql_v2.compare_ore_block_u64_8_256_terms
--! @note This is a transient type used only during query execution
CREATE TYPE eql_v2.ore_block_u64_8_256 AS (
  terms eql_v2.ore_block_u64_8_256_term[]
);

--! @brief HMAC-SHA256 index term type
--!
--! Domain type representing HMAC-SHA256 hash values.
--! Used for exact-match encrypted searches via the 'unique' index type.
--! The hash is stored in the 'hm' field of encrypted data payloads.
--!
--! @see eql_v2.add_search_config
--! @note This is a transient type used only during query execution
CREATE DOMAIN eql_v2.hmac_256 AS text;
-- AUTOMATICALLY GENERATED FILE

--! @file common.sql
--! @brief Common utility functions
--!
--! Provides general-purpose utility functions used across EQL:
--! - Constant-time bytea comparison for security
--! - JSONB to bytea array conversion
--! - Logging helpers for debugging and testing


--! @brief Constant-time comparison of bytea values
--! @internal
--!
--! Compares two bytea values in constant time to prevent timing attacks.
--! Always checks all bytes even after finding differences, maintaining
--! consistent execution time regardless of where differences occur.
--!
--! @param a bytea First value to compare
--! @param b bytea Second value to compare
--! @return boolean True if values are equal
--!
--! @note Returns false immediately if lengths differ (length is not secret)
--! @note Used for secure comparison of cryptographic values
CREATE FUNCTION eql_v2.bytea_eq(a bytea, b bytea) RETURNS boolean AS $$
DECLARE
    result boolean;
    differing bytea;
BEGIN

    -- Check if the bytea values are the same length
    IF LENGTH(a) != LENGTH(b) THEN
        RETURN false;
    END IF;

    -- Compare each byte in the bytea values
    result := true;
    FOR i IN 1..LENGTH(a) LOOP
        IF SUBSTRING(a FROM i FOR 1) != SUBSTRING(b FROM i FOR 1) THEN
            result := result AND false;
        END IF;
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql;


--! @brief Convert JSONB hex array to bytea array
--! @internal
--!
--! Converts a JSONB array of hex-encoded strings into a PostgreSQL bytea array.
--! Used for deserializing binary data (like ORE terms) from JSONB storage.
--!
--! @param jsonb JSONB array of hex-encoded strings
--! @return bytea[] Array of decoded binary values
--!
--! @note Returns NULL if input is JSON null
--! @note Each array element is hex-decoded to bytea
CREATE FUNCTION eql_v2.jsonb_array_to_bytea_array(val jsonb)
RETURNS bytea[] AS $$
DECLARE
  terms_arr bytea[];
BEGIN
  IF jsonb_typeof(val) = 'null' THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(decode(value::text, 'hex')::bytea)
    INTO terms_arr
  FROM jsonb_array_elements_text(val) AS value;

  RETURN terms_arr;
END;
$$ LANGUAGE plpgsql;


--! @brief Log message for debugging
--!
--! Convenience function to emit log messages during testing and debugging.
--! Uses RAISE NOTICE to output messages to PostgreSQL logs.
--!
--! @param text Message to log
--!
--! @note Primarily used in tests and development
--! @see eql_v2.log(text, text) for contextual logging
CREATE FUNCTION eql_v2.log(s text)
    RETURNS void
AS $$
  BEGIN
    RAISE NOTICE '[LOG] %', s;
END;
$$ LANGUAGE plpgsql;


--! @brief Log message with context
--!
--! Overload of log function that includes context label for better
--! log organization during testing.
--!
--! @param ctx text Context label (e.g., test name, module name)
--! @param s text Message to log
--!
--! @note Format: "[LOG] {ctx} {message}"
--! @see eql_v2.log(text)
CREATE FUNCTION eql_v2.log(ctx text, s text)
    RETURNS void
AS $$
  BEGIN
    RAISE NOTICE '[LOG] % %', ctx, s;
END;
$$ LANGUAGE plpgsql;

--! @brief CLLW ORE index term type for range queries
--!
--! Composite type for CLLW (Copyless Logarithmic Width) Order-Revealing Encryption.
--! Each output block is 8-bits. Used for encrypted range queries via the 'ore' index type.
--! The ciphertext is stored in the 'ocf' field of encrypted data payloads.
--!
--! @see eql_v2.add_search_config
--! @see eql_v2.compare_ore_cllw_u64_8
--! @note This is a transient type used only during query execution
CREATE TYPE eql_v2.ore_cllw_u64_8 AS (
  bytes bytea
);

--! @file crypto.sql
--! @brief PostgreSQL pgcrypto extension enablement
--!
--! Enables the pgcrypto extension which provides cryptographic functions
--! used by EQL for hashing and other cryptographic operations.
--!
--! @note pgcrypto provides functions like digest(), hmac(), gen_random_bytes()
--! @note IF NOT EXISTS prevents errors if extension already enabled

--! @brief Enable pgcrypto extension
--! @note Provides cryptographic functions for hashing and random number generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;


--! @brief Extract ciphertext from encrypted JSONB value
--!
--! Extracts the ciphertext (c field) from a raw JSONB encrypted value.
--! The ciphertext is the base64-encoded encrypted data.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Text Base64-encoded ciphertext string
--! @throws Exception if 'c' field is not present in JSONB
--!
--! @example
--! -- Extract ciphertext from JSONB literal
--! SELECT eql_v2.ciphertext('{"c":"AQIDBA==","i":{"unique":"..."}}'::jsonb);
--!
--! @see eql_v2.ciphertext(eql_v2_encrypted)
--! @see eql_v2.meta_data
CREATE FUNCTION eql_v2.ciphertext(val jsonb)
  RETURNS text
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    IF val ? 'c' THEN
      RETURN val->>'c';
    END IF;
    RAISE 'Expected a ciphertext (c) value in json: %', val;
  END;
$$ LANGUAGE plpgsql;

--! @brief Extract ciphertext from encrypted column value
--!
--! Extracts the ciphertext from an encrypted column value. Convenience
--! overload that unwraps eql_v2_encrypted type and delegates to JSONB version.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Text Base64-encoded ciphertext string
--! @throws Exception if encrypted value is malformed
--!
--! @example
--! -- Extract ciphertext from encrypted column
--! SELECT eql_v2.ciphertext(encrypted_email) FROM users;
--!
--! @see eql_v2.ciphertext(jsonb)
--! @see eql_v2.meta_data
CREATE FUNCTION eql_v2.ciphertext(val eql_v2_encrypted)
  RETURNS text
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.ciphertext(val.data);
  END;
$$ LANGUAGE plpgsql;

--! @brief State transition function for grouped_value aggregate
--! @internal
--!
--! Returns the first non-null value encountered. Used as state function
--! for the grouped_value aggregate to select first value in each group.
--!
--! @param $1 JSONB Accumulated state (first non-null value found)
--! @param $2 JSONB New value from current row
--! @return JSONB First non-null value (state or new value)
--!
--! @see eql_v2.grouped_value
CREATE FUNCTION eql_v2._first_grouped_value(jsonb, jsonb)
RETURNS jsonb AS $$
  SELECT COALESCE($1, $2);
$$ LANGUAGE sql IMMUTABLE;

--! @brief Return first non-null encrypted value in a group
--!
--! Aggregate function that returns the first non-null encrypted value
--! encountered within a GROUP BY clause. Useful for deduplication or
--! selecting representative values from grouped encrypted data.
--!
--! @param input JSONB Encrypted values to aggregate
--! @return JSONB First non-null encrypted value in group
--!
--! @example
--! -- Get first email per user group
--! SELECT user_id, eql_v2.grouped_value(encrypted_email)
--! FROM user_emails
--! GROUP BY user_id;
--!
--! -- Deduplicate encrypted values
--! SELECT DISTINCT ON (user_id)
--!   user_id,
--!   eql_v2.grouped_value(encrypted_ssn) as primary_ssn
--! FROM user_records
--! GROUP BY user_id;
--!
--! @see eql_v2._first_grouped_value
CREATE AGGREGATE eql_v2.grouped_value(jsonb) (
  SFUNC = eql_v2._first_grouped_value,
  STYPE = jsonb
);

--! @brief Add validation constraint to encrypted column
--!
--! Adds a CHECK constraint to ensure column values conform to encrypted data
--! structure. Constraint uses eql_v2.check_encrypted to validate format.
--! Called automatically by eql_v2.add_column.
--!
--! @param table_name TEXT Name of table containing the column
--! @param column_name TEXT Name of column to constrain
--! @return Void
--!
--! @example
--! -- Manually add constraint (normally done by add_column)
--! SELECT eql_v2.add_encrypted_constraint('users', 'encrypted_email');
--!
--! -- Resulting constraint:
--! -- ALTER TABLE users ADD CONSTRAINT eql_v2_encrypted_check_encrypted_email
--! --   CHECK (eql_v2.check_encrypted(encrypted_email));
--!
--! @see eql_v2.add_column
--! @see eql_v2.remove_encrypted_constraint
CREATE FUNCTION eql_v2.add_encrypted_constraint(table_name TEXT, column_name TEXT)
  RETURNS void
AS $$
	BEGIN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT eql_v2_encrypted_constraint_%I_%I CHECK (eql_v2.check_encrypted(%I))', table_name, table_name, column_name, column_name);
  EXCEPTION
    WHEN duplicate_table THEN
    WHEN duplicate_object THEN
      RAISE NOTICE 'Constraint \`eql_v2_encrypted_constraint_%_%\` already exists, skipping', table_name, column_name;
  END;
$$ LANGUAGE plpgsql;

--! @brief Remove validation constraint from encrypted column
--!
--! Removes the CHECK constraint that validates encrypted data structure.
--! Called automatically by eql_v2.remove_column. Uses IF EXISTS to avoid
--! errors if constraint doesn't exist.
--!
--! @param table_name TEXT Name of table containing the column
--! @param column_name TEXT Name of column to unconstrain
--! @return Void
--!
--! @example
--! -- Manually remove constraint (normally done by remove_column)
--! SELECT eql_v2.remove_encrypted_constraint('users', 'encrypted_email');
--!
--! @see eql_v2.remove_column
--! @see eql_v2.add_encrypted_constraint
CREATE FUNCTION eql_v2.remove_encrypted_constraint(table_name TEXT, column_name TEXT)
  RETURNS void
AS $$
	BEGIN
		EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS eql_v2_encrypted_constraint_%I_%I', table_name, table_name, column_name);
	END;
$$ LANGUAGE plpgsql;

--! @brief Extract metadata from encrypted JSONB value
--!
--! Extracts index terms (i) and version (v) from a raw JSONB encrypted value.
--! Returns metadata object containing searchable index terms without ciphertext.
--!
--! @param jsonb containing encrypted EQL payload
--! @return JSONB Metadata object with 'i' (index terms) and 'v' (version) fields
--!
--! @example
--! -- Extract metadata to inspect index terms
--! SELECT eql_v2.meta_data('{"c":"...","i":{"unique":"abc123"},"v":1}'::jsonb);
--! -- Returns: {"i":{"unique":"abc123"},"v":1}
--!
--! @see eql_v2.meta_data(eql_v2_encrypted)
--! @see eql_v2.ciphertext
CREATE FUNCTION eql_v2.meta_data(val jsonb)
  RETURNS jsonb
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
     RETURN jsonb_build_object(
      'i', val->'i',
      'v', val->'v'
    );
  END;
$$ LANGUAGE plpgsql;

--! @brief Extract metadata from encrypted column value
--!
--! Extracts index terms and version from an encrypted column value.
--! Convenience overload that unwraps eql_v2_encrypted type and
--! delegates to JSONB version.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return JSONB Metadata object with 'i' (index terms) and 'v' (version) fields
--!
--! @example
--! -- Inspect index terms for encrypted column
--! SELECT user_id, eql_v2.meta_data(encrypted_email) as email_metadata
--! FROM users;
--!
--! @see eql_v2.meta_data(jsonb)
--! @see eql_v2.ciphertext
CREATE FUNCTION eql_v2.meta_data(val eql_v2_encrypted)
  RETURNS jsonb
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
     RETURN eql_v2.meta_data(val.data);
  END;
$$ LANGUAGE plpgsql;


--! @brief Variable-width CLLW ORE index term type for range queries
--!
--! Composite type for variable-width CLLW (Copyless Logarithmic Width) Order-Revealing Encryption.
--! Each output block is 8-bits. Unlike ore_cllw_u64_8, supports variable-length ciphertexts.
--! Used for encrypted range queries via the 'ore' index type.
--! The ciphertext is stored in the 'ocv' field of encrypted data payloads.
--!
--! @see eql_v2.add_search_config
--! @see eql_v2.compare_ore_cllw_var_8
--! @note This is a transient type used only during query execution
CREATE TYPE eql_v2.ore_cllw_var_8 AS (
  bytes bytea
);


--! @brief Extract CLLW ORE index term from JSONB payload
--!
--! Extracts the CLLW ORE ciphertext from the 'ocf' field of an encrypted
--! data payload. Used internally for range query comparisons.
--!
--! @param jsonb containing encrypted EQL payload
--! @return eql_v2.ore_cllw_u64_8 CLLW ORE ciphertext
--! @throws Exception if 'ocf' field is missing when ore index is expected
--!
--! @see eql_v2.has_ore_cllw_u64_8
--! @see eql_v2.compare_ore_cllw_u64_8
CREATE FUNCTION eql_v2.ore_cllw_u64_8(val jsonb)
  RETURNS eql_v2.ore_cllw_u64_8
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    IF val IS NULL THEN
      RETURN NULL;
    END IF;

    IF NOT (eql_v2.has_ore_cllw_u64_8(val)) THEN
        RAISE 'Expected a ore_cllw_u64_8 index (ocf) value in json: %', val;
    END IF;

    RETURN ROW(decode(val->>'ocf', 'hex'));
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract CLLW ORE index term from encrypted column value
--!
--! Extracts the CLLW ORE ciphertext from an encrypted column value by accessing
--! its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return eql_v2.ore_cllw_u64_8 CLLW ORE ciphertext
--!
--! @see eql_v2.ore_cllw_u64_8(jsonb)
CREATE FUNCTION eql_v2.ore_cllw_u64_8(val eql_v2_encrypted)
  RETURNS eql_v2.ore_cllw_u64_8
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (SELECT eql_v2.ore_cllw_u64_8(val.data));
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if JSONB payload contains CLLW ORE index term
--!
--! Tests whether the encrypted data payload includes an 'ocf' field,
--! indicating a CLLW ORE ciphertext is available for range queries.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Boolean True if 'ocf' field is present and non-null
--!
--! @see eql_v2.ore_cllw_u64_8
CREATE FUNCTION eql_v2.has_ore_cllw_u64_8(val jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN val ->> 'ocf' IS NOT NULL;
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if encrypted column value contains CLLW ORE index term
--!
--! Tests whether an encrypted column value includes a CLLW ORE ciphertext
--! by checking its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Boolean True if CLLW ORE ciphertext is present
--!
--! @see eql_v2.has_ore_cllw_u64_8(jsonb)
CREATE FUNCTION eql_v2.has_ore_cllw_u64_8(val eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.has_ore_cllw_u64_8(val.data);
  END;
$$ LANGUAGE plpgsql;



--! @brief Compare CLLW ORE ciphertext bytes
--! @internal
--!
--! Byte-by-byte comparison of CLLW ORE ciphertexts implementing the CLLW
--! comparison algorithm. Used by both fixed-width (ore_cllw_u64_8) and
--! variable-width (ore_cllw_var_8) ORE variants.
--!
--! @param a Bytea First CLLW ORE ciphertext
--! @param b Bytea Second CLLW ORE ciphertext
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b
--! @throws Exception if ciphertexts are different lengths
--!
--! @note Shared comparison logic for multiple ORE CLLW schemes
--! @see eql_v2.compare_ore_cllw_u64_8
CREATE FUNCTION eql_v2.compare_ore_cllw_term_bytes(a bytea, b bytea)
RETURNS int AS $$
DECLARE
    len_a INT;
    len_b INT;
    x BYTEA;
    y BYTEA;
    i INT;
    differing boolean;
BEGIN

    -- Check if the lengths of the two bytea arguments are the same
    len_a := LENGTH(a);
    len_b := LENGTH(b);

    IF len_a != len_b THEN
      RAISE EXCEPTION 'ore_cllw index terms are not the same length';
    END IF;

    -- Iterate over each byte and compare them
    FOR i IN 1..len_a LOOP
        x := SUBSTRING(a FROM i FOR 1);
        y := SUBSTRING(b FROM i FOR 1);

        -- Check if there's a difference
        IF x != y THEN
            differing := true;
            EXIT;
        END IF;
    END LOOP;

    -- If a difference is found, compare the bytes as in Rust logic
    IF differing THEN
        IF (get_byte(y, 0) + 1) % 256 = get_byte(x, 0) THEN
            RETURN 1;
        ELSE
            RETURN -1;
        END IF;
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql;



--! @brief Blake3 hash index term type
--!
--! Domain type representing Blake3 cryptographic hash values.
--! Used for exact-match encrypted searches via the 'unique' index type.
--! The hash is stored in the 'b3' field of encrypted data payloads.
--!
--! @see eql_v2.add_search_config
--! @note This is a transient type used only during query execution
CREATE DOMAIN eql_v2.blake3 AS text;

--! @brief Extract Blake3 hash index term from JSONB payload
--!
--! Extracts the Blake3 hash value from the 'b3' field of an encrypted
--! data payload. Used internally for exact-match comparisons.
--!
--! @param jsonb containing encrypted EQL payload
--! @return eql_v2.blake3 Blake3 hash value, or NULL if not present
--! @throws Exception if 'b3' field is missing when blake3 index is expected
--!
--! @see eql_v2.has_blake3
--! @see eql_v2.compare_blake3
CREATE FUNCTION eql_v2.blake3(val jsonb)
  RETURNS eql_v2.blake3
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    IF val IS NULL THEN
      RETURN NULL;
    END IF;

    IF NOT eql_v2.has_blake3(val) THEN
        RAISE 'Expected a blake3 index (b3) value in json: %', val;
    END IF;

    IF val->>'b3' IS NULL THEN
      RETURN NULL;
    END IF;

    RETURN val->>'b3';
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract Blake3 hash index term from encrypted column value
--!
--! Extracts the Blake3 hash from an encrypted column value by accessing
--! its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return eql_v2.blake3 Blake3 hash value, or NULL if not present
--!
--! @see eql_v2.blake3(jsonb)
CREATE FUNCTION eql_v2.blake3(val eql_v2_encrypted)
  RETURNS eql_v2.blake3
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (SELECT eql_v2.blake3(val.data));
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if JSONB payload contains Blake3 index term
--!
--! Tests whether the encrypted data payload includes a 'b3' field,
--! indicating a Blake3 hash is available for exact-match queries.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Boolean True if 'b3' field is present and non-null
--!
--! @see eql_v2.blake3
CREATE FUNCTION eql_v2.has_blake3(val jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN val ->> 'b3' IS NOT NULL;
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if encrypted column value contains Blake3 index term
--!
--! Tests whether an encrypted column value includes a Blake3 hash
--! by checking its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Boolean True if Blake3 hash is present
--!
--! @see eql_v2.has_blake3(jsonb)
CREATE FUNCTION eql_v2.has_blake3(val eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.has_blake3(val.data);
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract HMAC-SHA256 index term from JSONB payload
--!
--! Extracts the HMAC-SHA256 hash value from the 'hm' field of an encrypted
--! data payload. Used internally for exact-match comparisons.
--!
--! @param jsonb containing encrypted EQL payload
--! @return eql_v2.hmac_256 HMAC-SHA256 hash value
--! @throws Exception if 'hm' field is missing when hmac_256 index is expected
--!
--! @see eql_v2.has_hmac_256
--! @see eql_v2.compare_hmac_256
CREATE FUNCTION eql_v2.hmac_256(val jsonb)
  RETURNS eql_v2.hmac_256
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    IF val IS NULL THEN
      RETURN NULL;
    END IF;

    IF eql_v2.has_hmac_256(val) THEN
      RETURN val->>'hm';
    END IF;
    RAISE 'Expected a hmac_256 index (hm) value in json: %', val;
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if JSONB payload contains HMAC-SHA256 index term
--!
--! Tests whether the encrypted data payload includes an 'hm' field,
--! indicating an HMAC-SHA256 hash is available for exact-match queries.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Boolean True if 'hm' field is present and non-null
--!
--! @see eql_v2.hmac_256
CREATE FUNCTION eql_v2.has_hmac_256(val jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN val ->> 'hm' IS NOT NULL;
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if encrypted column value contains HMAC-SHA256 index term
--!
--! Tests whether an encrypted column value includes an HMAC-SHA256 hash
--! by checking its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Boolean True if HMAC-SHA256 hash is present
--!
--! @see eql_v2.has_hmac_256(jsonb)
CREATE FUNCTION eql_v2.has_hmac_256(val eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.has_hmac_256(val.data);
  END;
$$ LANGUAGE plpgsql;



--! @brief Extract HMAC-SHA256 index term from encrypted column value
--!
--! Extracts the HMAC-SHA256 hash from an encrypted column value by accessing
--! its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return eql_v2.hmac_256 HMAC-SHA256 hash value
--!
--! @see eql_v2.hmac_256(jsonb)
CREATE FUNCTION eql_v2.hmac_256(val eql_v2_encrypted)
  RETURNS eql_v2.hmac_256
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (SELECT eql_v2.hmac_256(val.data));
  END;
$$ LANGUAGE plpgsql;




--! @brief Convert JSONB array to ORE block composite type
--! @internal
--!
--! Converts a JSONB array of hex-encoded ORE terms from the CipherStash Proxy
--! payload into the PostgreSQL composite type used for ORE operations.
--!
--! @param val JSONB Array of hex-encoded ORE block terms
--! @return eql_v2.ore_block_u64_8_256 ORE block composite type, or NULL if input is null
--!
--! @see eql_v2.ore_block_u64_8_256(jsonb)
CREATE FUNCTION eql_v2.jsonb_array_to_ore_block_u64_8_256(val jsonb)
RETURNS eql_v2.ore_block_u64_8_256 AS $$
DECLARE
  terms eql_v2.ore_block_u64_8_256_term[];
BEGIN
  IF jsonb_typeof(val) = 'null' THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(ROW(b)::eql_v2.ore_block_u64_8_256_term)
  INTO terms
  FROM unnest(eql_v2.jsonb_array_to_bytea_array(val)) AS b;

  RETURN ROW(terms)::eql_v2.ore_block_u64_8_256;
END;
$$ LANGUAGE plpgsql;


--! @brief Extract ORE block index term from JSONB payload
--!
--! Extracts the ORE block array from the 'ob' field of an encrypted
--! data payload. Used internally for range query comparisons.
--!
--! @param jsonb containing encrypted EQL payload
--! @return eql_v2.ore_block_u64_8_256 ORE block index term
--! @throws Exception if 'ob' field is missing when ore index is expected
--!
--! @see eql_v2.has_ore_block_u64_8_256
--! @see eql_v2.compare_ore_block_u64_8_256
CREATE FUNCTION eql_v2.ore_block_u64_8_256(val jsonb)
  RETURNS eql_v2.ore_block_u64_8_256
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    IF val IS NULL THEN
      RETURN NULL;
    END IF;

    IF eql_v2.has_ore_block_u64_8_256(val) THEN
      RETURN eql_v2.jsonb_array_to_ore_block_u64_8_256(val->'ob');
    END IF;
    RAISE 'Expected an ore index (ob) value in json: %', val;
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract ORE block index term from encrypted column value
--!
--! Extracts the ORE block from an encrypted column value by accessing
--! its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return eql_v2.ore_block_u64_8_256 ORE block index term
--!
--! @see eql_v2.ore_block_u64_8_256(jsonb)
CREATE FUNCTION eql_v2.ore_block_u64_8_256(val eql_v2_encrypted)
  RETURNS eql_v2.ore_block_u64_8_256
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.ore_block_u64_8_256(val.data);
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if JSONB payload contains ORE block index term
--!
--! Tests whether the encrypted data payload includes an 'ob' field,
--! indicating an ORE block is available for range queries.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Boolean True if 'ob' field is present and non-null
--!
--! @see eql_v2.ore_block_u64_8_256
CREATE FUNCTION eql_v2.has_ore_block_u64_8_256(val jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN val ->> 'ob' IS NOT NULL;
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if encrypted column value contains ORE block index term
--!
--! Tests whether an encrypted column value includes an ORE block
--! by checking its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Boolean True if ORE block is present
--!
--! @see eql_v2.has_ore_block_u64_8_256(jsonb)
CREATE FUNCTION eql_v2.has_ore_block_u64_8_256(val eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.has_ore_block_u64_8_256(val.data);
  END;
$$ LANGUAGE plpgsql;



--! @brief Compare two ORE block terms using cryptographic comparison
--! @internal
--!
--! Performs a three-way comparison (returns -1/0/1) of individual ORE block terms
--! using the ORE cryptographic protocol. Compares PRP and PRF blocks to determine
--! ordering without decryption.
--!
--! @param a eql_v2.ore_block_u64_8_256_term First ORE term to compare
--! @param b eql_v2.ore_block_u64_8_256_term Second ORE term to compare
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b
--! @throws Exception if ciphertexts are different lengths
--!
--! @note Uses AES-ECB encryption for bit comparisons per ORE protocol
--! @see eql_v2.compare_ore_block_u64_8_256_terms
CREATE FUNCTION eql_v2.compare_ore_block_u64_8_256_term(a eql_v2.ore_block_u64_8_256_term, b eql_v2.ore_block_u64_8_256_term)
  RETURNS integer
AS $$
  DECLARE
    eq boolean := true;
    unequal_block smallint := 0;
    hash_key bytea;
    data_block bytea;
    encrypt_block bytea;
    target_block bytea;

    left_block_size CONSTANT smallint := 16;
    right_block_size CONSTANT smallint := 32;
    right_offset CONSTANT smallint := 136; -- 8 * 17

    indicator smallint := 0;
  BEGIN
    IF a IS NULL AND b IS NULL THEN
      RETURN 0;
    END IF;

    IF a IS NULL THEN
      RETURN -1;
    END IF;

    IF b IS NULL THEN
      RETURN 1;
    END IF;

    IF bit_length(a.bytes) != bit_length(b.bytes) THEN
      RAISE EXCEPTION 'Ciphertexts are different lengths';
    END IF;

    FOR block IN 0..7 LOOP
      -- Compare each PRP (byte from the first 8 bytes) and PRF block (8 byte
      -- chunks of the rest of the value).
      -- NOTE:
      -- * Substr is ordinally indexed (hence 1 and not 0, and 9 and not 8).
      -- * We are not worrying about timing attacks here; don't fret about
      --   the OR or !=.
      IF
        substr(a.bytes, 1 + block, 1) != substr(b.bytes, 1 + block, 1)
        OR substr(a.bytes, 9 + left_block_size * block, left_block_size) != substr(b.bytes, 9 + left_block_size * BLOCK, left_block_size)
      THEN
        -- set the first unequal block we find
        IF eq THEN
          unequal_block := block;
        END IF;
        eq = false;
      END IF;
    END LOOP;

    IF eq THEN
      RETURN 0::integer;
    END IF;

    -- Hash key is the IV from the right CT of b
    hash_key := substr(b.bytes, right_offset + 1, 16);

    -- first right block is at right offset + nonce_size (ordinally indexed)
    target_block := substr(b.bytes, right_offset + 17 + (unequal_block * right_block_size), right_block_size);

    data_block := substr(a.bytes, 9 + (left_block_size * unequal_block), left_block_size);

    encrypt_block := public.encrypt(data_block::bytea, hash_key::bytea, 'aes-ecb');

    indicator := (
      get_bit(
        encrypt_block,
        0
      ) + get_bit(target_block, get_byte(a.bytes, unequal_block))) % 2;

    IF indicator = 1 THEN
      RETURN 1::integer;
    ELSE
      RETURN -1::integer;
    END IF;
  END;
$$ LANGUAGE plpgsql;


--! @brief Compare arrays of ORE block terms recursively
--! @internal
--!
--! Recursively compares arrays of ORE block terms element-by-element.
--! Empty arrays are considered less than non-empty arrays. If the first elements
--! are equal, recursively compares remaining elements.
--!
--! @param a eql_v2.ore_block_u64_8_256_term[] First array of ORE terms
--! @param b eql_v2.ore_block_u64_8_256_term[] Second array of ORE terms
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b, NULL if either array is NULL
--!
--! @note Empty arrays sort before non-empty arrays
--! @see eql_v2.compare_ore_block_u64_8_256_term
CREATE FUNCTION eql_v2.compare_ore_block_u64_8_256_terms(a eql_v2.ore_block_u64_8_256_term[], b eql_v2.ore_block_u64_8_256_term[])
RETURNS integer AS $$
  DECLARE
    cmp_result integer;
  BEGIN

    -- NULLs are NULL
    IF a IS NULL OR b IS NULL THEN
      RETURN NULL;
    END IF;

    -- empty a and b
    IF cardinality(a) = 0 AND cardinality(b) = 0 THEN
      RETURN 0;
    END IF;

    -- empty a and some b
    IF (cardinality(a) = 0) AND cardinality(b) > 0 THEN
      RETURN -1;
    END IF;

    -- some a and empty b
    IF cardinality(a) > 0 AND (cardinality(b) = 0) THEN
      RETURN 1;
    END IF;

    cmp_result := eql_v2.compare_ore_block_u64_8_256_term(a[1], b[1]);

    IF cmp_result = 0 THEN
    -- Removes the first element in the array, and calls this fn again to compare the next element/s in the array.
      RETURN eql_v2.compare_ore_block_u64_8_256_terms(a[2:array_length(a,1)], b[2:array_length(b,1)]);
    END IF;

    RETURN cmp_result;
  END
$$ LANGUAGE plpgsql;


--! @brief Compare ORE block composite types
--! @internal
--!
--! Wrapper function that extracts term arrays from ORE block composite types
--! and delegates to the array comparison function.
--!
--! @param a eql_v2.ore_block_u64_8_256 First ORE block
--! @param b eql_v2.ore_block_u64_8_256 Second ORE block
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b
--!
--! @see eql_v2.compare_ore_block_u64_8_256_terms(eql_v2.ore_block_u64_8_256_term[], eql_v2.ore_block_u64_8_256_term[])
CREATE FUNCTION eql_v2.compare_ore_block_u64_8_256_terms(a eql_v2.ore_block_u64_8_256, b eql_v2.ore_block_u64_8_256)
RETURNS integer AS $$
  BEGIN
    RETURN eql_v2.compare_ore_block_u64_8_256_terms(a.terms, b.terms);
  END
$$ LANGUAGE plpgsql;


--! @brief Extract variable-width CLLW ORE index term from JSONB payload
--!
--! Extracts the variable-width CLLW ORE ciphertext from the 'ocv' field of an encrypted
--! data payload. Used internally for range query comparisons.
--!
--! @param jsonb containing encrypted EQL payload
--! @return eql_v2.ore_cllw_var_8 Variable-width CLLW ORE ciphertext
--! @throws Exception if 'ocv' field is missing when ore index is expected
--!
--! @see eql_v2.has_ore_cllw_var_8
--! @see eql_v2.compare_ore_cllw_var_8
CREATE FUNCTION eql_v2.ore_cllw_var_8(val jsonb)
  RETURNS eql_v2.ore_cllw_var_8
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN

    IF val IS NULL THEN
      RETURN NULL;
    END IF;

    IF NOT (eql_v2.has_ore_cllw_var_8(val)) THEN
        RAISE 'Expected a ore_cllw_var_8 index (ocv) value in json: %', val;
    END IF;

    RETURN ROW(decode(val->>'ocv', 'hex'));
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract variable-width CLLW ORE index term from encrypted column value
--!
--! Extracts the variable-width CLLW ORE ciphertext from an encrypted column value by accessing
--! its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return eql_v2.ore_cllw_var_8 Variable-width CLLW ORE ciphertext
--!
--! @see eql_v2.ore_cllw_var_8(jsonb)
CREATE FUNCTION eql_v2.ore_cllw_var_8(val eql_v2_encrypted)
  RETURNS eql_v2.ore_cllw_var_8
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (SELECT eql_v2.ore_cllw_var_8(val.data));
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if JSONB payload contains variable-width CLLW ORE index term
--!
--! Tests whether the encrypted data payload includes an 'ocv' field,
--! indicating a variable-width CLLW ORE ciphertext is available for range queries.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Boolean True if 'ocv' field is present and non-null
--!
--! @see eql_v2.ore_cllw_var_8
CREATE FUNCTION eql_v2.has_ore_cllw_var_8(val jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN val ->> 'ocv' IS NOT NULL;
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if encrypted column value contains variable-width CLLW ORE index term
--!
--! Tests whether an encrypted column value includes a variable-width CLLW ORE ciphertext
--! by checking its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Boolean True if variable-width CLLW ORE ciphertext is present
--!
--! @see eql_v2.has_ore_cllw_var_8(jsonb)
CREATE FUNCTION eql_v2.has_ore_cllw_var_8(val eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.has_ore_cllw_var_8(val.data);
  END;
$$ LANGUAGE plpgsql;


--! @brief Compare variable-width CLLW ORE ciphertext terms
--! @internal
--!
--! Three-way comparison of variable-width CLLW ORE ciphertexts. Compares the common
--! prefix using byte-by-byte CLLW comparison, then falls back to length comparison
--! if the common prefix is equal. Used by compare_ore_cllw_var_8 for range queries.
--!
--! @param a eql_v2.ore_cllw_var_8 First variable-width CLLW ORE ciphertext
--! @param b eql_v2.ore_cllw_var_8 Second variable-width CLLW ORE ciphertext
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b
--!
--! @note Handles variable-length ciphertexts by comparing common prefix first
--! @note Returns NULL if either input is NULL
--!
--! @see eql_v2.compare_ore_cllw_term_bytes
--! @see eql_v2.compare_ore_cllw_var_8
CREATE FUNCTION eql_v2.compare_ore_cllw_var_8_term(a eql_v2.ore_cllw_var_8, b eql_v2.ore_cllw_var_8)
RETURNS int AS $$
DECLARE
    len_a INT;
    len_b INT;
    -- length of the common part of the two bytea values
    common_len INT;
    cmp_result INT;
BEGIN
    IF a IS NULL OR b IS NULL THEN
      RETURN NULL;
    END IF;

    -- Get the lengths of both bytea inputs
    len_a := LENGTH(a.bytes);
    len_b := LENGTH(b.bytes);

    -- Handle empty cases
    IF len_a = 0 AND len_b = 0 THEN
        RETURN 0;
    ELSIF len_a = 0 THEN
        RETURN -1;
    ELSIF len_b = 0 THEN
        RETURN 1;
    END IF;

    -- Find the length of the shorter bytea
    IF len_a < len_b THEN
        common_len := len_a;
    ELSE
        common_len := len_b;
    END IF;

    -- Use the compare_ore_cllw_term function to compare byte by byte
    cmp_result := eql_v2.compare_ore_cllw_term_bytes(
      SUBSTRING(a.bytes FROM 1 FOR common_len),
      SUBSTRING(b.bytes FROM 1 FOR common_len)
    );

    -- If the comparison returns 'less' or 'greater', return that result
    IF cmp_result = -1 THEN
        RETURN -1;
    ELSIF cmp_result = 1 THEN
        RETURN 1;
    END IF;

    -- If the bytea comparison is 'equal', compare lengths
    IF len_a < len_b THEN
        RETURN -1;
    ELSIF len_a > len_b THEN
        RETURN 1;
    ELSE
        RETURN 0;
    END IF;
END;
$$ LANGUAGE plpgsql;






--! @brief Core comparison function for encrypted values
--!
--! Compares two encrypted values using their index terms without decryption.
--! This function implements all comparison operators required for btree indexing
--! (<, <=, =, >=, >).
--!
--! Index terms are checked in the following priority order:
--! 1. ore_block_u64_8_256 (Order-Revealing Encryption)
--! 2. ore_cllw_u64_8 (Order-Revealing Encryption)
--! 3. ore_cllw_var_8 (Order-Revealing Encryption)
--! 4. hmac_256 (Hash-based equality)
--! 5. blake3 (Hash-based equality)
--!
--! The first index term type present in both values is used for comparison.
--! If no matching index terms are found, falls back to JSONB literal comparison
--! to ensure consistent ordering (required for btree correctness).
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return integer -1 if a < b, 0 if a = b, 1 if a > b
--!
--! @note Literal fallback prevents "lock BufferContent is not held" errors
--! @see eql_v2.compare_ore_block_u64_8_256
--! @see eql_v2.compare_blake3
--! @see eql_v2.compare_hmac_256
CREATE FUNCTION eql_v2.compare(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS integer
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN

    IF a IS NULL AND b IS NULL THEN
      RETURN 0;
    END IF;

    IF a IS NULL THEN
      RETURN -1;
    END IF;

    IF b IS NULL THEN
      RETURN 1;
    END IF;

    a := eql_v2.to_ste_vec_value(a);
    b := eql_v2.to_ste_vec_value(b);

    IF eql_v2.has_ore_block_u64_8_256(a) AND eql_v2.has_ore_block_u64_8_256(b) THEN
      RETURN eql_v2.compare_ore_block_u64_8_256(a, b);
    END IF;

    IF eql_v2.has_ore_cllw_u64_8(a) AND eql_v2.has_ore_cllw_u64_8(b) THEN
      RETURN eql_v2.compare_ore_cllw_u64_8(a, b);
    END IF;

    IF eql_v2.has_ore_cllw_var_8(a) AND eql_v2.has_ore_cllw_var_8(b) THEN
      RETURN eql_v2.compare_ore_cllw_var_8(a, b);
    END IF;

    IF eql_v2.has_hmac_256(a) AND eql_v2.has_hmac_256(b) THEN
      RETURN eql_v2.compare_hmac_256(a, b);
    END IF;

    IF eql_v2.has_blake3(a) AND eql_v2.has_blake3(b) THEN
      RETURN eql_v2.compare_blake3(a, b);
    END IF;

    -- Fallback to literal comparison of the encrypted data
    -- Compare must have consistent ordering for a given state
    -- Without this text fallback, database errors with "lock BufferContent is not held"
    RETURN eql_v2.compare_literal(a, b);

  END;
$$ LANGUAGE plpgsql;



--! @brief Convert JSONB to encrypted type
--!
--! Wraps a JSONB encrypted payload into the eql_v2_encrypted composite type.
--! Used internally for type conversions and operator implementations.
--!
--! @param jsonb JSONB encrypted payload with structure: {"c": "...", "i": {...}, "k": "...", "v": "2"}
--! @return eql_v2_encrypted Encrypted value wrapped in composite type
--!
--! @note This is primarily used for implicit casts in operator expressions
--! @see eql_v2.to_jsonb
CREATE FUNCTION eql_v2.to_encrypted(data jsonb)
    RETURNS public.eql_v2_encrypted
    IMMUTABLE STRICT PARALLEL SAFE
AS $$
BEGIN
    IF data IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN ROW(data)::public.eql_v2_encrypted;
END;
$$ LANGUAGE plpgsql;


--! @brief Implicit cast from JSONB to encrypted type
--!
--! Enables PostgreSQL to automatically convert JSONB values to eql_v2_encrypted
--! in assignment contexts and comparison operations.
--!
--! @see eql_v2.to_encrypted(jsonb)
CREATE CAST (jsonb AS public.eql_v2_encrypted)
	WITH FUNCTION eql_v2.to_encrypted(jsonb) AS ASSIGNMENT;


--! @brief Convert text to encrypted type
--!
--! Parses a text representation of encrypted JSONB payload and wraps it
--! in the eql_v2_encrypted composite type.
--!
--! @param text Text representation of JSONB encrypted payload
--! @return eql_v2_encrypted Encrypted value wrapped in composite type
--!
--! @note Delegates to eql_v2.to_encrypted(jsonb) after parsing text as JSON
--! @see eql_v2.to_encrypted(jsonb)
CREATE FUNCTION eql_v2.to_encrypted(data text)
    RETURNS public.eql_v2_encrypted
    IMMUTABLE STRICT PARALLEL SAFE
AS $$
BEGIN
    IF data IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN eql_v2.to_encrypted(data::jsonb);
END;
$$ LANGUAGE plpgsql;


--! @brief Implicit cast from text to encrypted type
--!
--! Enables PostgreSQL to automatically convert text JSON strings to eql_v2_encrypted
--! in assignment contexts.
--!
--! @see eql_v2.to_encrypted(text)
CREATE CAST (text AS public.eql_v2_encrypted)
	WITH FUNCTION eql_v2.to_encrypted(text) AS ASSIGNMENT;



--! @brief Convert encrypted type to JSONB
--!
--! Extracts the underlying JSONB payload from an eql_v2_encrypted composite type.
--! Useful for debugging or when raw encrypted payload access is needed.
--!
--! @param e eql_v2_encrypted Encrypted value to unwrap
--! @return jsonb Raw JSONB encrypted payload
--!
--! @note Returns the raw encrypted structure including ciphertext and index terms
--! @see eql_v2.to_encrypted(jsonb)
CREATE FUNCTION eql_v2.to_jsonb(e public.eql_v2_encrypted)
    RETURNS jsonb
    IMMUTABLE STRICT PARALLEL SAFE
AS $$
BEGIN
    IF e IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN e.data;
END;
$$ LANGUAGE plpgsql;

--! @brief Implicit cast from encrypted type to JSONB
--!
--! Enables PostgreSQL to automatically extract the JSONB payload from
--! eql_v2_encrypted values in assignment contexts.
--!
--! @see eql_v2.to_jsonb(eql_v2_encrypted)
CREATE CAST (public.eql_v2_encrypted AS jsonb)
	WITH FUNCTION eql_v2.to_jsonb(public.eql_v2_encrypted) AS ASSIGNMENT;



--! @file config/types.sql
--! @brief Configuration state type definition
--!
--! Defines the ENUM type for tracking encryption configuration lifecycle states.
--! The configuration table uses this type to manage transitions between states
--! during setup, activation, and encryption operations.
--!
--! @note CREATE TYPE does not support IF NOT EXISTS, so wrapped in DO block
--! @note Configuration data stored as JSONB directly, not as DOMAIN
--! @see config/tables.sql


--! @brief Configuration lifecycle state
--!
--! Defines valid states for encryption configurations in the eql_v2_configuration table.
--! Configurations transition through these states during setup and activation.
--!
--! @note Only one configuration can be in 'active', 'pending', or 'encrypting' state at once
--! @see config/indexes.sql for uniqueness enforcement
--! @see config/tables.sql for usage in eql_v2_configuration table
DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eql_v2_configuration_state') THEN
      CREATE TYPE public.eql_v2_configuration_state AS ENUM ('active', 'inactive', 'encrypting', 'pending');
    END IF;
  END
$$;



--! @brief Extract Bloom filter index term from JSONB payload
--!
--! Extracts the Bloom filter array from the 'bf' field of an encrypted
--! data payload. Used internally for pattern-match queries (LIKE operator).
--!
--! @param jsonb containing encrypted EQL payload
--! @return eql_v2.bloom_filter Bloom filter as smallint array
--! @throws Exception if 'bf' field is missing when bloom_filter index is expected
--!
--! @see eql_v2.has_bloom_filter
--! @see eql_v2."~~"
CREATE FUNCTION eql_v2.bloom_filter(val jsonb)
  RETURNS eql_v2.bloom_filter
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    IF val IS NULL THEN
      RETURN NULL;
    END IF;

    IF eql_v2.has_bloom_filter(val) THEN
      RETURN ARRAY(SELECT jsonb_array_elements(val->'bf'))::eql_v2.bloom_filter;
    END IF;

    RAISE 'Expected a match index (bf) value in json: %', val;
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract Bloom filter index term from encrypted column value
--!
--! Extracts the Bloom filter from an encrypted column value by accessing
--! its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return eql_v2.bloom_filter Bloom filter as smallint array
--!
--! @see eql_v2.bloom_filter(jsonb)
CREATE FUNCTION eql_v2.bloom_filter(val eql_v2_encrypted)
  RETURNS eql_v2.bloom_filter
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (SELECT eql_v2.bloom_filter(val.data));
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if JSONB payload contains Bloom filter index term
--!
--! Tests whether the encrypted data payload includes a 'bf' field,
--! indicating a Bloom filter is available for pattern-match queries.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Boolean True if 'bf' field is present and non-null
--!
--! @see eql_v2.bloom_filter
CREATE FUNCTION eql_v2.has_bloom_filter(val jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN val ->> 'bf' IS NOT NULL;
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if encrypted column value contains Bloom filter index term
--!
--! Tests whether an encrypted column value includes a Bloom filter
--! by checking its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Boolean True if Bloom filter is present
--!
--! @see eql_v2.has_bloom_filter(jsonb)
CREATE FUNCTION eql_v2.has_bloom_filter(val eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.has_bloom_filter(val.data);
  END;
$$ LANGUAGE plpgsql;

--! @brief Fallback literal comparison for encrypted values
--! @internal
--!
--! Compares two encrypted values by their raw JSONB representation when no
--! suitable index terms are available. This ensures consistent ordering required
--! for btree correctness and prevents "lock BufferContent is not held" errors.
--!
--! Used as a last resort fallback in eql_v2.compare() when encrypted values
--! lack matching index terms (blake3, hmac_256, ore).
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return integer -1 if a < b, 0 if a = b, 1 if a > b
--!
--! @note This compares the encrypted payloads directly, not the plaintext values
--! @note Ordering is consistent but not meaningful for range queries
--! @see eql_v2.compare
CREATE FUNCTION eql_v2.compare_literal(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS integer
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    a_data jsonb;
    b_data jsonb;
  BEGIN

    IF a IS NULL AND b IS NULL THEN
      RETURN 0;
    END IF;

    IF a IS NULL THEN
      RETURN -1;
    END IF;

    IF b IS NULL THEN
      RETURN 1;
    END IF;

    a_data := a.data;
    b_data := b.data;

    IF a_data < b_data THEN
      RETURN -1;
    END IF;

    IF a_data > b_data THEN
      RETURN 1;
    END IF;

    RETURN 0;
  END;
$$ LANGUAGE plpgsql;

--! @brief Less-than comparison helper for encrypted values
--! @internal
--!
--! Internal helper that delegates to eql_v2.compare for less-than testing.
--! Returns true if first value is less than second using ORE comparison.
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return Boolean True if a < b (compare result = -1)
--!
--! @see eql_v2.compare
--! @see eql_v2."<"
CREATE FUNCTION eql_v2.lt(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.compare(a, b) = -1;
  END;
$$ LANGUAGE plpgsql;

--! @brief Less-than operator for encrypted values
--!
--! Implements the < operator for comparing two encrypted values using Order-Revealing
--! Encryption (ORE) index terms. Enables range queries and sorting without decryption.
--! Requires 'ore' index configuration on the column.
--!
--! @param a eql_v2_encrypted Left operand
--! @param b eql_v2_encrypted Right operand
--! @return Boolean True if a is less than b
--!
--! @example
--! -- Range query on encrypted timestamps
--! SELECT * FROM events
--! WHERE encrypted_timestamp < '2024-01-01'::timestamp::text::eql_v2_encrypted;
--!
--! -- Compare encrypted numeric columns
--! SELECT * FROM products WHERE encrypted_price < encrypted_discount_price;
--!
--! @see eql_v2.compare
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2."<"(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.lt(a, b);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR <(
  FUNCTION=eql_v2."<",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted,
  COMMUTATOR = >,
  NEGATOR = >=,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);

--! @brief Less-than operator for encrypted value and JSONB
--!
--! Overload of < operator accepting JSONB on the right side. Automatically
--! casts JSONB to eql_v2_encrypted for ORE comparison.
--!
--! @param eql_v2_encrypted Left operand (encrypted value)
--! @param b JSONB Right operand (will be cast to eql_v2_encrypted)
--! @return Boolean True if a < b
--!
--! @example
--! SELECT * FROM events WHERE encrypted_age < '18'::int::text::jsonb;
--!
--! @see eql_v2."<"(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."<"(a eql_v2_encrypted, b jsonb)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.lt(a, b::eql_v2_encrypted);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR <(
  FUNCTION=eql_v2."<",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=jsonb,
  COMMUTATOR = >,
  NEGATOR = >=,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);

--! @brief Less-than operator for JSONB and encrypted value
--!
--! Overload of < operator accepting JSONB on the left side. Automatically
--! casts JSONB to eql_v2_encrypted for ORE comparison.
--!
--! @param a JSONB Left operand (will be cast to eql_v2_encrypted)
--! @param eql_v2_encrypted Right operand (encrypted value)
--! @return Boolean True if a < b
--!
--! @example
--! SELECT * FROM events WHERE '2023-01-01'::date::text::jsonb < encrypted_date;
--!
--! @see eql_v2."<"(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."<"(a jsonb, b eql_v2_encrypted)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.lt(a::eql_v2_encrypted, b);
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR <(
  FUNCTION=eql_v2."<",
  LEFTARG=jsonb,
  RIGHTARG=eql_v2_encrypted,
  COMMUTATOR = >,
  NEGATOR = >=,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);



--! @brief Less-than-or-equal comparison helper for encrypted values
--! @internal
--!
--! Internal helper that delegates to eql_v2.compare for <= testing.
--! Returns true if first value is less than or equal to second using ORE comparison.
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return Boolean True if a <= b (compare result <= 0)
--!
--! @see eql_v2.compare
--! @see eql_v2."<="
CREATE FUNCTION eql_v2.lte(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.compare(a, b) <= 0;
  END;
$$ LANGUAGE plpgsql;

--! @brief Less-than-or-equal operator for encrypted values
--!
--! Implements the <= operator for comparing encrypted values using ORE index terms.
--! Enables range queries with inclusive lower bounds without decryption.
--!
--! @param a eql_v2_encrypted Left operand
--! @param b eql_v2_encrypted Right operand
--! @return Boolean True if a <= b
--!
--! @example
--! -- Find records with encrypted age 18 or under
--! SELECT * FROM users WHERE encrypted_age <= '18'::int::text::eql_v2_encrypted;
--!
--! @see eql_v2.compare
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2."<="(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.lte(a, b);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR <=(
  FUNCTION = eql_v2."<=",
  LEFTARG = eql_v2_encrypted,
  RIGHTARG = eql_v2_encrypted,
  COMMUTATOR = >=,
  NEGATOR = >,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);

--! @brief <= operator for encrypted value and JSONB
--! @see eql_v2."<="(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."<="(a eql_v2_encrypted, b jsonb)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.lte(a, b::eql_v2_encrypted);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR <=(
  FUNCTION = eql_v2."<=",
  LEFTARG = eql_v2_encrypted,
  RIGHTARG = jsonb,
  COMMUTATOR = >=,
  NEGATOR = >,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);

--! @brief <= operator for JSONB and encrypted value
--! @see eql_v2."<="(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."<="(a jsonb, b eql_v2_encrypted)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.lte(a::eql_v2_encrypted, b);
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR <=(
  FUNCTION = eql_v2."<=",
  LEFTARG = jsonb,
  RIGHTARG = eql_v2_encrypted,
  COMMUTATOR = >=,
  NEGATOR = >,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);



--! @brief Equality comparison helper for encrypted values
--! @internal
--!
--! Internal helper that delegates to eql_v2.compare for equality testing.
--! Returns true if encrypted values are equal via encrypted index comparison.
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return Boolean True if values are equal (compare result = 0)
--!
--! @see eql_v2.compare
--! @see eql_v2."="
CREATE FUNCTION eql_v2.eq(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN eql_v2.compare(a, b) = 0;
  END;
$$ LANGUAGE plpgsql;

--! @brief Equality operator for encrypted values
--!
--! Implements the = operator for comparing two encrypted values using their
--! encrypted index terms (unique/blake3). Enables WHERE clause comparisons
--! without decryption.
--!
--! @param a eql_v2_encrypted Left operand
--! @param b eql_v2_encrypted Right operand
--! @return Boolean True if encrypted values are equal
--!
--! @example
--! -- Compare encrypted columns
--! SELECT * FROM users WHERE encrypted_email = other_encrypted_email;
--!
--! -- Search using encrypted literal
--! SELECT * FROM users
--! WHERE encrypted_email = '{"c":"...","i":{"unique":"..."}}'::eql_v2_encrypted;
--!
--! @see eql_v2.compare
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2."="(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN eql_v2.eq(a, b);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR = (
  FUNCTION=eql_v2."=",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted,
  NEGATOR = <>,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);

--! @brief Equality operator for encrypted value and JSONB
--!
--! Overload of = operator accepting JSONB on the right side. Automatically
--! casts JSONB to eql_v2_encrypted for comparison. Useful for comparing
--! against JSONB literals or columns.
--!
--! @param eql_v2_encrypted Left operand (encrypted value)
--! @param b JSONB Right operand (will be cast to eql_v2_encrypted)
--! @return Boolean True if values are equal
--!
--! @example
--! -- Compare encrypted column to JSONB literal
--! SELECT * FROM users
--! WHERE encrypted_email = '{"c":"...","i":{"unique":"..."}}'::jsonb;
--!
--! @see eql_v2."="(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."="(a eql_v2_encrypted, b jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN eql_v2.eq(a, b::eql_v2_encrypted);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR = (
  FUNCTION=eql_v2."=",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=jsonb,
  NEGATOR = <>,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);

--! @brief Equality operator for JSONB and encrypted value
--!
--! Overload of = operator accepting JSONB on the left side. Automatically
--! casts JSONB to eql_v2_encrypted for comparison. Enables commutative
--! equality comparisons.
--!
--! @param a JSONB Left operand (will be cast to eql_v2_encrypted)
--! @param eql_v2_encrypted Right operand (encrypted value)
--! @return Boolean True if values are equal
--!
--! @example
--! -- Compare JSONB literal to encrypted column
--! SELECT * FROM users
--! WHERE '{"c":"...","i":{"unique":"..."}}'::jsonb = encrypted_email;
--!
--! @see eql_v2."="(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."="(a jsonb, b eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN eql_v2.eq(a::eql_v2_encrypted, b);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR = (
  FUNCTION=eql_v2."=",
  LEFTARG=jsonb,
  RIGHTARG=eql_v2_encrypted,
  NEGATOR = <>,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);


--! @brief Greater-than-or-equal comparison helper for encrypted values
--! @internal
--!
--! Internal helper that delegates to eql_v2.compare for >= testing.
--! Returns true if first value is greater than or equal to second using ORE comparison.
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return Boolean True if a >= b (compare result >= 0)
--!
--! @see eql_v2.compare
--! @see eql_v2.">="
CREATE FUNCTION eql_v2.gte(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.compare(a, b) >= 0;
  END;
$$ LANGUAGE plpgsql;

--! @brief Greater-than-or-equal operator for encrypted values
--!
--! Implements the >= operator for comparing encrypted values using ORE index terms.
--! Enables range queries with inclusive upper bounds without decryption.
--!
--! @param a eql_v2_encrypted Left operand
--! @param b eql_v2_encrypted Right operand
--! @return Boolean True if a >= b
--!
--! @example
--! -- Find records with age 18 or over
--! SELECT * FROM users WHERE encrypted_age >= '18'::int::text::eql_v2_encrypted;
--!
--! @see eql_v2.compare
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2.">="(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.gte(a, b);
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR >=(
  FUNCTION = eql_v2.">=",
  LEFTARG = eql_v2_encrypted,
  RIGHTARG = eql_v2_encrypted,
  COMMUTATOR = <=,
  NEGATOR = <,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);

--! @brief >= operator for encrypted value and JSONB
--! @see eql_v2.">="(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2.">="(a eql_v2_encrypted, b jsonb)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.gte(a, b::eql_v2_encrypted);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR >=(
  FUNCTION = eql_v2.">=",
  LEFTARG = eql_v2_encrypted,
  RIGHTARG=jsonb,
  COMMUTATOR = <=,
  NEGATOR = <,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);

--! @brief >= operator for JSONB and encrypted value
--! @see eql_v2.">="(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2.">="(a jsonb, b eql_v2_encrypted)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.gte(a::eql_v2_encrypted, b);
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR >=(
  FUNCTION = eql_v2.">=",
  LEFTARG = jsonb,
  RIGHTARG =eql_v2_encrypted,
  COMMUTATOR = <=,
  NEGATOR = <,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);



--! @brief Greater-than comparison helper for encrypted values
--! @internal
--!
--! Internal helper that delegates to eql_v2.compare for greater-than testing.
--! Returns true if first value is greater than second using ORE comparison.
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return Boolean True if a > b (compare result = 1)
--!
--! @see eql_v2.compare
--! @see eql_v2.">"
CREATE FUNCTION eql_v2.gt(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.compare(a, b) = 1;
  END;
$$ LANGUAGE plpgsql;

--! @brief Greater-than operator for encrypted values
--!
--! Implements the > operator for comparing encrypted values using ORE index terms.
--! Enables range queries and sorting without decryption. Requires 'ore' index
--! configuration on the column.
--!
--! @param a eql_v2_encrypted Left operand
--! @param b eql_v2_encrypted Right operand
--! @return Boolean True if a is greater than b
--!
--! @example
--! -- Find records above threshold
--! SELECT * FROM events
--! WHERE encrypted_value > '100'::int::text::eql_v2_encrypted;
--!
--! @see eql_v2.compare
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2.">"(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.gt(a, b);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR >(
  FUNCTION=eql_v2.">",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted,
  COMMUTATOR = <,
  NEGATOR = <=,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);

--! @brief > operator for encrypted value and JSONB
--! @see eql_v2.">"(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2.">"(a eql_v2_encrypted, b jsonb)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.gt(a, b::eql_v2_encrypted);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR >(
  FUNCTION = eql_v2.">",
  LEFTARG = eql_v2_encrypted,
  RIGHTARG = jsonb,
  COMMUTATOR = <,
  NEGATOR = <=,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);

--! @brief > operator for JSONB and encrypted value
--! @see eql_v2.">"(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2.">"(a jsonb, b eql_v2_encrypted)
RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.gt(a::eql_v2_encrypted, b);
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR >(
  FUNCTION = eql_v2.">",
  LEFTARG = jsonb,
  RIGHTARG = eql_v2_encrypted,
  COMMUTATOR = <,
  NEGATOR = <=,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);




--! @brief Extract STE vector index from JSONB payload
--!
--! Extracts the STE (Searchable Symmetric Encryption) vector from the 'sv' field
--! of an encrypted data payload. Returns an array of encrypted values used for
--! containment queries (@>, <@). If no 'sv' field exists, wraps the entire payload
--! as a single-element array.
--!
--! @param jsonb containing encrypted EQL payload
--! @return eql_v2_encrypted[] Array of encrypted STE vector elements
--!
--! @see eql_v2.ste_vec(eql_v2_encrypted)
--! @see eql_v2.ste_vec_contains
CREATE FUNCTION eql_v2.ste_vec(val jsonb)
  RETURNS public.eql_v2_encrypted[]
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    sv jsonb;
    ary public.eql_v2_encrypted[];
	BEGIN

    IF val ? 'sv' THEN
      sv := val->'sv';
    ELSE
      sv := jsonb_build_array(val);
    END IF;

    SELECT array_agg(eql_v2.to_encrypted(elem))
      INTO ary
      FROM jsonb_array_elements(sv) AS elem;

    RETURN ary;
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract STE vector index from encrypted column value
--!
--! Extracts the STE vector from an encrypted column value by accessing its
--! underlying JSONB data field. Used for containment query operations.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return eql_v2_encrypted[] Array of encrypted STE vector elements
--!
--! @see eql_v2.ste_vec(jsonb)
CREATE FUNCTION eql_v2.ste_vec(val eql_v2_encrypted)
  RETURNS public.eql_v2_encrypted[]
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (SELECT eql_v2.ste_vec(val.data));
  END;
$$ LANGUAGE plpgsql;

--! @brief Check if JSONB payload is a single-element STE vector
--!
--! Tests whether the encrypted data payload contains an 'sv' field with exactly
--! one element. Single-element STE vectors can be treated as regular encrypted values.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Boolean True if 'sv' field exists with exactly one element
--!
--! @see eql_v2.to_ste_vec_value
CREATE FUNCTION eql_v2.is_ste_vec_value(val jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    IF val ? 'sv' THEN
      RETURN jsonb_array_length(val->'sv') = 1;
    END IF;

    RETURN false;
  END;
$$ LANGUAGE plpgsql;

--! @brief Check if encrypted column value is a single-element STE vector
--!
--! Tests whether an encrypted column value is a single-element STE vector
--! by checking its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Boolean True if value is a single-element STE vector
--!
--! @see eql_v2.is_ste_vec_value(jsonb)
CREATE FUNCTION eql_v2.is_ste_vec_value(val eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.is_ste_vec_value(val.data);
  END;
$$ LANGUAGE plpgsql;

--! @brief Convert single-element STE vector to regular encrypted value
--!
--! Extracts the single element from a single-element STE vector and returns it
--! as a regular encrypted value, preserving metadata. If the input is not a
--! single-element STE vector, returns it unchanged.
--!
--! @param jsonb containing encrypted EQL payload
--! @return eql_v2_encrypted Regular encrypted value (unwrapped if single-element STE vector)
--!
--! @see eql_v2.is_ste_vec_value
CREATE FUNCTION eql_v2.to_ste_vec_value(val jsonb)
  RETURNS eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    meta jsonb;
    sv jsonb;
	BEGIN

    IF val IS NULL THEN
      RETURN NULL;
    END IF;

    IF eql_v2.is_ste_vec_value(val) THEN
      meta := eql_v2.meta_data(val);
      sv := val->'sv';
      sv := sv[0];

      RETURN eql_v2.to_encrypted(meta || sv);
    END IF;

    RETURN eql_v2.to_encrypted(val);
  END;
$$ LANGUAGE plpgsql;

--! @brief Convert single-element STE vector to regular encrypted value (encrypted type)
--!
--! Converts an encrypted column value to a regular encrypted value by unwrapping
--! if it's a single-element STE vector.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return eql_v2_encrypted Regular encrypted value (unwrapped if single-element STE vector)
--!
--! @see eql_v2.to_ste_vec_value(jsonb)
CREATE FUNCTION eql_v2.to_ste_vec_value(val eql_v2_encrypted)
  RETURNS eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2.to_ste_vec_value(val.data);
  END;
$$ LANGUAGE plpgsql;

--! @brief Extract selector value from JSONB payload
--!
--! Extracts the selector ('s') field from an encrypted data payload.
--! Selectors are used to match STE vector elements during containment queries.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Text The selector value
--! @throws Exception if 's' field is missing
--!
--! @see eql_v2.ste_vec_contains
CREATE FUNCTION eql_v2.selector(val jsonb)
  RETURNS text
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    IF val IS NULL THEN
      RETURN NULL;
    END IF;

    IF val ? 's' THEN
      RETURN val->>'s';
    END IF;
    RAISE 'Expected a selector index (s) value in json: %', val;
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract selector value from encrypted column value
--!
--! Extracts the selector from an encrypted column value by accessing its
--! underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Text The selector value
--!
--! @see eql_v2.selector(jsonb)
CREATE FUNCTION eql_v2.selector(val eql_v2_encrypted)
  RETURNS text
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (SELECT eql_v2.selector(val.data));
  END;
$$ LANGUAGE plpgsql;



--! @brief Check if JSONB payload is marked as an STE vector array
--!
--! Tests whether the encrypted data payload has the 'a' (array) flag set to true,
--! indicating it represents an array for STE vector operations.
--!
--! @param jsonb containing encrypted EQL payload
--! @return Boolean True if 'a' field is present and true
--!
--! @see eql_v2.ste_vec
CREATE FUNCTION eql_v2.is_ste_vec_array(val jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    IF val ? 'a' THEN
      RETURN (val->>'a')::boolean;
    END IF;

    RETURN false;
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if encrypted column value is marked as an STE vector array
--!
--! Tests whether an encrypted column value has the array flag set by checking
--! its underlying JSONB data field.
--!
--! @param eql_v2_encrypted Encrypted column value
--! @return Boolean True if value is marked as an STE vector array
--!
--! @see eql_v2.is_ste_vec_array(jsonb)
CREATE FUNCTION eql_v2.is_ste_vec_array(val eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (SELECT eql_v2.is_ste_vec_array(val.data));
  END;
$$ LANGUAGE plpgsql;



--! @brief Extract full encrypted JSONB elements as array
--!
--! Extracts all JSONB elements from the STE vector including non-deterministic fields.
--! Use jsonb_array() instead for GIN indexing and containment queries.
--!
--! @param val jsonb containing encrypted EQL payload
--! @return jsonb[] Array of full JSONB elements
--!
--! @see eql_v2.jsonb_array
CREATE FUNCTION eql_v2.jsonb_array_from_array_elements(val jsonb)
RETURNS jsonb[]
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT CASE
    WHEN val ? 'sv' THEN
      ARRAY(SELECT elem FROM jsonb_array_elements(val->'sv') AS elem)
    ELSE
      ARRAY[val]
  END;
$$;


--! @brief Extract full encrypted JSONB elements as array from encrypted column
--!
--! @param val eql_v2_encrypted Encrypted column value
--! @return jsonb[] Array of full JSONB elements
--!
--! @see eql_v2.jsonb_array_from_array_elements(jsonb)
CREATE FUNCTION eql_v2.jsonb_array_from_array_elements(val eql_v2_encrypted)
RETURNS jsonb[]
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT eql_v2.jsonb_array_from_array_elements(val.data);
$$;


--! @brief Extract deterministic fields as array for GIN indexing
--!
--! Extracts only deterministic search term fields (s, b3, hm, ocv, ocf) from each
--! STE vector element. Excludes non-deterministic ciphertext for correct containment
--! comparison using PostgreSQL's native @> operator.
--!
--! @param val jsonb containing encrypted EQL payload
--! @return jsonb[] Array of JSONB elements with only deterministic fields
--!
--! @note Use this for GIN indexes and containment queries
--! @see eql_v2.jsonb_contains
CREATE FUNCTION eql_v2.jsonb_array(val jsonb)
RETURNS jsonb[]
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT ARRAY(
    SELECT jsonb_object_agg(kv.key, kv.value)
    FROM jsonb_array_elements(
      CASE WHEN val ? 'sv' THEN val->'sv' ELSE jsonb_build_array(val) END
    ) AS elem,
    LATERAL jsonb_each(elem) AS kv(key, value)
    WHERE kv.key IN ('s', 'b3', 'hm', 'ocv', 'ocf')
    GROUP BY elem
  );
$$;


--! @brief Extract deterministic fields as array from encrypted column
--!
--! @param val eql_v2_encrypted Encrypted column value
--! @return jsonb[] Array of JSONB elements with only deterministic fields
--!
--! @see eql_v2.jsonb_array(jsonb)
CREATE FUNCTION eql_v2.jsonb_array(val eql_v2_encrypted)
RETURNS jsonb[]
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT eql_v2.jsonb_array(val.data);
$$;


--! @brief GIN-indexable JSONB containment check
--!
--! Checks if encrypted value 'a' contains all JSONB elements from 'b'.
--! Uses jsonb[] arrays internally for native PostgreSQL GIN index support.
--!
--! This function is designed for use with a GIN index on jsonb_array(column).
--! When combined with such an index, PostgreSQL can efficiently search large tables.
--!
--! @param a eql_v2_encrypted Container value (typically a table column)
--! @param b eql_v2_encrypted Value to search for
--! @return Boolean True if a contains all elements of b
--!
--! @example
--! -- Create GIN index for efficient containment queries
--! CREATE INDEX idx ON mytable USING GIN (eql_v2.jsonb_array(encrypted_col));
--!
--! -- Query using the helper function
--! SELECT * FROM mytable WHERE eql_v2.jsonb_contains(encrypted_col, search_value);
--!
--! @see eql_v2.jsonb_array
CREATE FUNCTION eql_v2.jsonb_contains(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT eql_v2.jsonb_array(a) @> eql_v2.jsonb_array(b);
$$;


--! @brief GIN-indexable JSONB containment check (encrypted, jsonb)
--!
--! Checks if encrypted value 'a' contains all JSONB elements from jsonb value 'b'.
--! Uses jsonb[] arrays internally for native PostgreSQL GIN index support.
--!
--! @param a eql_v2_encrypted Container value (typically a table column)
--! @param b jsonb JSONB value to search for
--! @return Boolean True if a contains all elements of b
--!
--! @see eql_v2.jsonb_array
--! @see eql_v2.jsonb_contains(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2.jsonb_contains(a eql_v2_encrypted, b jsonb)
RETURNS boolean
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT eql_v2.jsonb_array(a) @> eql_v2.jsonb_array(b);
$$;


--! @brief GIN-indexable JSONB containment check (jsonb, encrypted)
--!
--! Checks if jsonb value 'a' contains all JSONB elements from encrypted value 'b'.
--! Uses jsonb[] arrays internally for native PostgreSQL GIN index support.
--!
--! @param a jsonb Container JSONB value
--! @param b eql_v2_encrypted Encrypted value to search for
--! @return Boolean True if a contains all elements of b
--!
--! @see eql_v2.jsonb_array
--! @see eql_v2.jsonb_contains(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2.jsonb_contains(a jsonb, b eql_v2_encrypted)
RETURNS boolean
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT eql_v2.jsonb_array(a) @> eql_v2.jsonb_array(b);
$$;


--! @brief GIN-indexable JSONB "is contained by" check
--!
--! Checks if all JSONB elements from 'a' are contained in 'b'.
--! Uses jsonb[] arrays internally for native PostgreSQL GIN index support.
--!
--! @param a eql_v2_encrypted Value to check (typically a table column)
--! @param b eql_v2_encrypted Container value
--! @return Boolean True if all elements of a are contained in b
--!
--! @see eql_v2.jsonb_array
--! @see eql_v2.jsonb_contains
CREATE FUNCTION eql_v2.jsonb_contained_by(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT eql_v2.jsonb_array(a) <@ eql_v2.jsonb_array(b);
$$;


--! @brief GIN-indexable JSONB "is contained by" check (encrypted, jsonb)
--!
--! Checks if all JSONB elements from encrypted value 'a' are contained in jsonb value 'b'.
--! Uses jsonb[] arrays internally for native PostgreSQL GIN index support.
--!
--! @param a eql_v2_encrypted Value to check (typically a table column)
--! @param b jsonb Container JSONB value
--! @return Boolean True if all elements of a are contained in b
--!
--! @see eql_v2.jsonb_array
--! @see eql_v2.jsonb_contained_by(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2.jsonb_contained_by(a eql_v2_encrypted, b jsonb)
RETURNS boolean
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT eql_v2.jsonb_array(a) <@ eql_v2.jsonb_array(b);
$$;


--! @brief GIN-indexable JSONB "is contained by" check (jsonb, encrypted)
--!
--! Checks if all JSONB elements from jsonb value 'a' are contained in encrypted value 'b'.
--! Uses jsonb[] arrays internally for native PostgreSQL GIN index support.
--!
--! @param a jsonb Value to check
--! @param b eql_v2_encrypted Container encrypted value
--! @return Boolean True if all elements of a are contained in b
--!
--! @see eql_v2.jsonb_array
--! @see eql_v2.jsonb_contained_by(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2.jsonb_contained_by(a jsonb, b eql_v2_encrypted)
RETURNS boolean
IMMUTABLE STRICT PARALLEL SAFE
LANGUAGE SQL
AS $$
  SELECT eql_v2.jsonb_array(a) <@ eql_v2.jsonb_array(b);
$$;


--! @brief Check if STE vector array contains a specific encrypted element
--!
--! Tests whether any element in the STE vector array 'a' contains the encrypted value 'b'.
--! Matching requires both the selector and encrypted value to be equal.
--! Used internally by ste_vec_contains(encrypted, encrypted) for array containment checks.
--!
--! @param eql_v2_encrypted[] STE vector array to search within
--! @param eql_v2_encrypted Encrypted element to search for
--! @return Boolean True if b is found in any element of a
--!
--! @note Compares both selector and encrypted value for match
--!
--! @see eql_v2.selector
--! @see eql_v2.ste_vec_contains(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2.ste_vec_contains(a public.eql_v2_encrypted[], b eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    result boolean;
    _a public.eql_v2_encrypted;
  BEGIN

    result := false;

    FOR idx IN 1..array_length(a, 1) LOOP
      _a := a[idx];
      result := result OR (eql_v2.selector(_a) = eql_v2.selector(b) AND _a = b);
    END LOOP;

    RETURN result;
  END;
$$ LANGUAGE plpgsql;


--! @brief Check if encrypted value 'a' contains all elements of encrypted value 'b'
--!
--! Performs STE vector containment comparison between two encrypted values.
--! Returns true if all elements in b's STE vector are found in a's STE vector.
--! Used internally by the @> containment operator for searchable encryption.
--!
--! @param a eql_v2_encrypted First encrypted value (container)
--! @param b eql_v2_encrypted Second encrypted value (elements to find)
--! @return Boolean True if all elements of b are contained in a
--!
--! @note Empty b is always contained in any a
--! @note Each element of b must match both selector and value in a
--!
--! @see eql_v2.ste_vec
--! @see eql_v2.ste_vec_contains(eql_v2_encrypted[], eql_v2_encrypted)
--! @see eql_v2."@>"
CREATE FUNCTION eql_v2.ste_vec_contains(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    result boolean;
    sv_a public.eql_v2_encrypted[];
    sv_b public.eql_v2_encrypted[];
    _b public.eql_v2_encrypted;
  BEGIN

    -- jsonb arrays of ste_vec encrypted values
    sv_a := eql_v2.ste_vec(a);
    sv_b := eql_v2.ste_vec(b);

    -- an empty b is always contained in a
    IF array_length(sv_b, 1) IS NULL THEN
      RETURN true;
    END IF;

    IF array_length(sv_a, 1) IS NULL THEN
      RETURN false;
    END IF;

    result := true;

    -- for each element of b check if it is in a
    FOR idx IN 1..array_length(sv_b, 1) LOOP
      _b := sv_b[idx];
      result := result AND eql_v2.ste_vec_contains(sv_a, _b);
    END LOOP;

    RETURN result;
  END;
$$ LANGUAGE plpgsql;

--! @file config/tables.sql
--! @brief Encryption configuration storage table
--!
--! Defines the main table for storing EQL v2 encryption configurations.
--! Each row represents a configuration specifying which tables/columns to encrypt
--! and what index types to use. Configurations progress through lifecycle states.
--!
--! @see config/types.sql for state ENUM definition
--! @see config/indexes.sql for state uniqueness constraints
--! @see config/constraints.sql for data validation


--! @brief Encryption configuration table
--!
--! Stores encryption configurations with their state and metadata.
--! The 'data' JSONB column contains the full configuration structure including
--! table/column mappings, index types, and casting rules.
--!
--! @note Only one configuration can be 'active', 'pending', or 'encrypting' at once
--! @note 'id' is auto-generated identity column
--! @note 'state' defaults to 'pending' for new configurations
--! @note 'data' validated by CHECK constraint (see config/constraints.sql)
CREATE TABLE IF NOT EXISTS public.eql_v2_configuration
(
    id bigint GENERATED ALWAYS AS IDENTITY,
    state eql_v2_configuration_state NOT NULL DEFAULT 'pending',
    data jsonb,
    created_at timestamptz not null default current_timestamp,
    PRIMARY KEY(id)
);


--! @brief Initialize default configuration structure
--! @internal
--!
--! Creates a default configuration object if input is NULL. Used internally
--! by public configuration functions to ensure consistent structure.
--!
--! @param config JSONB Existing configuration or NULL
--! @return JSONB Configuration with default structure (version 1, empty tables)
CREATE FUNCTION eql_v2.config_default(config jsonb)
  RETURNS jsonb
  IMMUTABLE PARALLEL SAFE
AS $$
  BEGIN
    IF config IS NULL THEN
      SELECT jsonb_build_object('v', 1, 'tables', jsonb_build_object()) INTO config;
    END IF;
    RETURN config;
  END;
$$ LANGUAGE plpgsql;

--! @brief Add table to configuration if not present
--! @internal
--!
--! Ensures the specified table exists in the configuration structure.
--! Creates empty table entry if needed. Idempotent operation.
--!
--! @param table_name Text Name of table to add
--! @param config JSONB Configuration object
--! @return JSONB Updated configuration with table entry
CREATE FUNCTION eql_v2.config_add_table(table_name text, config jsonb)
  RETURNS jsonb
  IMMUTABLE PARALLEL SAFE
AS $$
  DECLARE
    tbl jsonb;
  BEGIN
    IF NOT config #> array['tables'] ? table_name THEN
      SELECT jsonb_insert(config, array['tables', table_name], jsonb_build_object()) INTO config;
    END IF;
    RETURN config;
  END;
$$ LANGUAGE plpgsql;

--! @brief Add column to table configuration if not present
--! @internal
--!
--! Ensures the specified column exists in the table's configuration structure.
--! Creates empty column entry with indexes object if needed. Idempotent operation.
--!
--! @param table_name Text Name of parent table
--! @param column_name Text Name of column to add
--! @param config JSONB Configuration object
--! @return JSONB Updated configuration with column entry
CREATE FUNCTION eql_v2.config_add_column(table_name text, column_name text, config jsonb)
  RETURNS jsonb
  IMMUTABLE PARALLEL SAFE
AS $$
  DECLARE
    col jsonb;
  BEGIN
    IF NOT config #> array['tables', table_name] ? column_name THEN
      SELECT jsonb_build_object('indexes', jsonb_build_object()) into col;
      SELECT jsonb_set(config, array['tables', table_name, column_name], col) INTO config;
    END IF;
    RETURN config;
  END;
$$ LANGUAGE plpgsql;

--! @brief Set cast type for column in configuration
--! @internal
--!
--! Updates the cast_as field for a column, specifying the PostgreSQL type
--! that decrypted values should be cast to.
--!
--! @param table_name Text Name of parent table
--! @param column_name Text Name of column
--! @param cast_as Text PostgreSQL type for casting (e.g., 'text', 'int', 'jsonb')
--! @param config JSONB Configuration object
--! @return JSONB Updated configuration with cast_as set
CREATE FUNCTION eql_v2.config_add_cast(table_name text, column_name text, cast_as text, config jsonb)
  RETURNS jsonb
  IMMUTABLE PARALLEL SAFE
AS $$
  BEGIN
    SELECT jsonb_set(config, array['tables', table_name, column_name, 'cast_as'], to_jsonb(cast_as)) INTO config;
    RETURN config;
  END;
$$ LANGUAGE plpgsql;

--! @brief Add search index to column configuration
--! @internal
--!
--! Inserts a search index entry (unique, match, ore, ste_vec) with its options
--! into the column's indexes object.
--!
--! @param table_name Text Name of parent table
--! @param column_name Text Name of column
--! @param index_name Text Type of index to add
--! @param opts JSONB Index-specific options
--! @param config JSONB Configuration object
--! @return JSONB Updated configuration with index added
CREATE FUNCTION eql_v2.config_add_index(table_name text, column_name text, index_name text, opts jsonb, config jsonb)
  RETURNS jsonb
  IMMUTABLE PARALLEL SAFE
AS $$
  BEGIN
    SELECT jsonb_insert(config, array['tables', table_name, column_name, 'indexes', index_name], opts) INTO config;
    RETURN config;
  END;
$$ LANGUAGE plpgsql;

--! @brief Generate default options for match index
--! @internal
--!
--! Returns default configuration for match (LIKE) indexes: k=6, bf=2048,
--! ngram tokenizer with token_length=3, downcase filter, include_original=true.
--!
--! @return JSONB Default match index options
CREATE FUNCTION eql_v2.config_match_default()
  RETURNS jsonb
LANGUAGE sql STRICT PARALLEL SAFE
BEGIN ATOMIC
  SELECT jsonb_build_object(
            'k', 6,
            'bf', 2048,
            'include_original', true,
            'tokenizer', json_build_object('kind', 'ngram', 'token_length', 3),
            'token_filters', json_build_array(json_build_object('kind', 'downcase')));
END;
-- AUTOMATICALLY GENERATED FILE
-- Source is version-template.sql

DROP FUNCTION IF EXISTS eql_v2.version();

--! @file version.sql
--! @brief EQL version reporting
--!
--! This file is auto-generated from version.template during build.
--! The version string placeholder is replaced with the actual release version.

--! @brief Get EQL library version string
--!
--! Returns the version string for the installed EQL library.
--! This value is set at build time from the project version.
--!
--! @return text Version string (e.g., "2.1.0" or "DEV" for development builds)
--!
--! @note Auto-generated during build from version.template
--!
--! @example
--! -- Check installed EQL version
--! SELECT eql_v2.version();
--! -- Returns: '2.1.0'
CREATE FUNCTION eql_v2.version()
  RETURNS text
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT 'eql-2.2.1';
$$ LANGUAGE SQL;



--! @brief Compare two encrypted values using variable-width CLLW ORE index terms
--!
--! Performs a three-way comparison (returns -1/0/1) of encrypted values using
--! their variable-width CLLW ORE ciphertext index terms. Used internally by range operators
--! (<, <=, >, >=) for order-revealing comparisons without decryption.
--!
--! @param a eql_v2_encrypted First encrypted value to compare
--! @param b eql_v2_encrypted Second encrypted value to compare
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b
--!
--! @note NULL values are sorted before non-NULL values
--! @note Uses variable-width CLLW ORE cryptographic protocol for secure comparisons
--!
--! @see eql_v2.ore_cllw_var_8
--! @see eql_v2.has_ore_cllw_var_8
--! @see eql_v2.compare_ore_cllw_var_8_term
--! @see eql_v2."<"
--! @see eql_v2.">"
CREATE FUNCTION eql_v2.compare_ore_cllw_var_8(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS integer
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    a_term eql_v2.ore_cllw_var_8;
    b_term eql_v2.ore_cllw_var_8;
  BEGIN

    -- PERFORM eql_v2.log('eql_v2.compare_ore_cllw_var_8');
    -- PERFORM eql_v2.log('a', a::text);
    -- PERFORM eql_v2.log('b', b::text);

    IF a IS NULL AND b IS NULL THEN
      RETURN 0;
    END IF;

    IF a IS NULL THEN
      RETURN -1;
    END IF;

    IF b IS NULL THEN
      RETURN 1;
    END IF;

    IF eql_v2.has_ore_cllw_var_8(a) THEN
      a_term := eql_v2.ore_cllw_var_8(a);
    END IF;

    IF eql_v2.has_ore_cllw_var_8(a) THEN
      b_term := eql_v2.ore_cllw_var_8(b);
    END IF;

    IF a_term IS NULL AND b_term IS NULL THEN
      RETURN 0;
    END IF;

    IF a_term IS NULL THEN
      RETURN -1;
    END IF;

    IF b_term IS NULL THEN
      RETURN 1;
    END IF;

    RETURN eql_v2.compare_ore_cllw_var_8_term(a_term, b_term);
  END;
$$ LANGUAGE plpgsql;



--! @brief Compare two encrypted values using CLLW ORE index terms
--!
--! Performs a three-way comparison (returns -1/0/1) of encrypted values using
--! their CLLW ORE ciphertext index terms. Used internally by range operators
--! (<, <=, >, >=) for order-revealing comparisons without decryption.
--!
--! @param a eql_v2_encrypted First encrypted value to compare
--! @param b eql_v2_encrypted Second encrypted value to compare
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b
--!
--! @note NULL values are sorted before non-NULL values
--! @note Uses CLLW ORE cryptographic protocol for secure comparisons
--!
--! @see eql_v2.ore_cllw_u64_8
--! @see eql_v2.has_ore_cllw_u64_8
--! @see eql_v2.compare_ore_cllw_term_bytes
--! @see eql_v2."<"
--! @see eql_v2.">"
CREATE FUNCTION eql_v2.compare_ore_cllw_u64_8(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS integer
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    a_term eql_v2.ore_cllw_u64_8;
    b_term eql_v2.ore_cllw_u64_8;
  BEGIN

    -- PERFORM eql_v2.log('eql_v2.compare_ore_cllw_u64_8');
    -- PERFORM eql_v2.log('a', a::text);
    -- PERFORM eql_v2.log('b', b::text);

    IF a IS NULL AND b IS NULL THEN
      RETURN 0;
    END IF;

    IF a IS NULL THEN
      RETURN -1;
    END IF;

    IF b IS NULL THEN
      RETURN 1;
    END IF;

    IF eql_v2.has_ore_cllw_u64_8(a) THEN
      a_term := eql_v2.ore_cllw_u64_8(a);
    END IF;

    IF eql_v2.has_ore_cllw_u64_8(a) THEN
      b_term := eql_v2.ore_cllw_u64_8(b);
    END IF;

    IF a_term IS NULL AND b_term IS NULL THEN
      RETURN 0;
    END IF;

    IF a_term IS NULL THEN
      RETURN -1;
    END IF;

    IF b_term IS NULL THEN
      RETURN 1;
    END IF;

    RETURN eql_v2.compare_ore_cllw_term_bytes(a_term.bytes, b_term.bytes);
  END;
$$ LANGUAGE plpgsql;

-- NOTE FILE IS DISABLED


--! @brief Equality operator for ORE block types
--! @internal
--!
--! Implements the = operator for direct ORE block comparisons.
--!
--! @param a eql_v2.ore_block_u64_8_256 Left operand
--! @param b eql_v2.ore_block_u64_8_256 Right operand
--! @return Boolean True if ORE blocks are equal
--!
--! @note FILE IS DISABLED - Not included in build
--! @see eql_v2.compare_ore_block_u64_8_256_terms
CREATE FUNCTION eql_v2.ore_block_u64_8_256_eq(a eql_v2.ore_block_u64_8_256, b eql_v2.ore_block_u64_8_256)
RETURNS boolean AS $$
  SELECT eql_v2.compare_ore_block_u64_8_256_terms(a, b) = 0
$$ LANGUAGE SQL;



--! @brief Not equal operator for ORE block types
--! @internal
--!
--! Implements the <> operator for direct ORE block comparisons.
--!
--! @param a eql_v2.ore_block_u64_8_256 Left operand
--! @param b eql_v2.ore_block_u64_8_256 Right operand
--! @return Boolean True if ORE blocks are not equal
--!
--! @note FILE IS DISABLED - Not included in build
--! @see eql_v2.compare_ore_block_u64_8_256_terms
CREATE FUNCTION eql_v2.ore_block_u64_8_256_neq(a eql_v2.ore_block_u64_8_256, b eql_v2.ore_block_u64_8_256)
RETURNS boolean AS $$
  SELECT eql_v2.compare_ore_block_u64_8_256_terms(a, b) <> 0
$$ LANGUAGE SQL;



--! @brief Less than operator for ORE block types
--! @internal
--!
--! Implements the < operator for direct ORE block comparisons.
--!
--! @param a eql_v2.ore_block_u64_8_256 Left operand
--! @param b eql_v2.ore_block_u64_8_256 Right operand
--! @return Boolean True if left operand is less than right operand
--!
--! @note FILE IS DISABLED - Not included in build
--! @see eql_v2.compare_ore_block_u64_8_256_terms
CREATE FUNCTION eql_v2.ore_block_u64_8_256_lt(a eql_v2.ore_block_u64_8_256, b eql_v2.ore_block_u64_8_256)
RETURNS boolean AS $$
  SELECT eql_v2.compare_ore_block_u64_8_256_terms(a, b) = -1
$$ LANGUAGE SQL;



--! @brief Less than or equal operator for ORE block types
--! @internal
--!
--! Implements the <= operator for direct ORE block comparisons.
--!
--! @param a eql_v2.ore_block_u64_8_256 Left operand
--! @param b eql_v2.ore_block_u64_8_256 Right operand
--! @return Boolean True if left operand is less than or equal to right operand
--!
--! @note FILE IS DISABLED - Not included in build
--! @see eql_v2.compare_ore_block_u64_8_256_terms
CREATE FUNCTION eql_v2.ore_block_u64_8_256_lte(a eql_v2.ore_block_u64_8_256, b eql_v2.ore_block_u64_8_256)
RETURNS boolean AS $$
  SELECT eql_v2.compare_ore_block_u64_8_256_terms(a, b) != 1
$$ LANGUAGE SQL;



--! @brief Greater than operator for ORE block types
--! @internal
--!
--! Implements the > operator for direct ORE block comparisons.
--!
--! @param a eql_v2.ore_block_u64_8_256 Left operand
--! @param b eql_v2.ore_block_u64_8_256 Right operand
--! @return Boolean True if left operand is greater than right operand
--!
--! @note FILE IS DISABLED - Not included in build
--! @see eql_v2.compare_ore_block_u64_8_256_terms
CREATE FUNCTION eql_v2.ore_block_u64_8_256_gt(a eql_v2.ore_block_u64_8_256, b eql_v2.ore_block_u64_8_256)
RETURNS boolean AS $$
  SELECT eql_v2.compare_ore_block_u64_8_256_terms(a, b) = 1
$$ LANGUAGE SQL;



--! @brief Greater than or equal operator for ORE block types
--! @internal
--!
--! Implements the >= operator for direct ORE block comparisons.
--!
--! @param a eql_v2.ore_block_u64_8_256 Left operand
--! @param b eql_v2.ore_block_u64_8_256 Right operand
--! @return Boolean True if left operand is greater than or equal to right operand
--!
--! @note FILE IS DISABLED - Not included in build
--! @see eql_v2.compare_ore_block_u64_8_256_terms
CREATE FUNCTION eql_v2.ore_block_u64_8_256_gte(a eql_v2.ore_block_u64_8_256, b eql_v2.ore_block_u64_8_256)
RETURNS boolean AS $$
  SELECT eql_v2.compare_ore_block_u64_8_256_terms(a, b) != -1
$$ LANGUAGE SQL;



--! @brief = operator for ORE block types
--! @note FILE IS DISABLED - Not included in build
CREATE OPERATOR = (
  FUNCTION=eql_v2.ore_block_u64_8_256_eq,
  LEFTARG=eql_v2.ore_block_u64_8_256,
  RIGHTARG=eql_v2.ore_block_u64_8_256,
  NEGATOR = <>,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);



--! @brief <> operator for ORE block types
--! @note FILE IS DISABLED - Not included in build
CREATE OPERATOR <> (
  FUNCTION=eql_v2.ore_block_u64_8_256_neq,
  LEFTARG=eql_v2.ore_block_u64_8_256,
  RIGHTARG=eql_v2.ore_block_u64_8_256,
  NEGATOR = =,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);


--! @brief > operator for ORE block types
--! @note FILE IS DISABLED - Not included in build
CREATE OPERATOR > (
  FUNCTION=eql_v2.ore_block_u64_8_256_gt,
  LEFTARG=eql_v2.ore_block_u64_8_256,
  RIGHTARG=eql_v2.ore_block_u64_8_256,
  COMMUTATOR = <,
  NEGATOR = <=,
  RESTRICT = scalargtsel,
  JOIN = scalargtjoinsel
);



--! @brief < operator for ORE block types
--! @note FILE IS DISABLED - Not included in build
CREATE OPERATOR < (
  FUNCTION=eql_v2.ore_block_u64_8_256_lt,
  LEFTARG=eql_v2.ore_block_u64_8_256,
  RIGHTARG=eql_v2.ore_block_u64_8_256,
  COMMUTATOR = >,
  NEGATOR = >=,
  RESTRICT = scalarltsel,
  JOIN = scalarltjoinsel
);



--! @brief <= operator for ORE block types
--! @note FILE IS DISABLED - Not included in build
CREATE OPERATOR <= (
  FUNCTION=eql_v2.ore_block_u64_8_256_lte,
  LEFTARG=eql_v2.ore_block_u64_8_256,
  RIGHTARG=eql_v2.ore_block_u64_8_256,
  COMMUTATOR = >=,
  NEGATOR = >,
  RESTRICT = scalarlesel,
  JOIN = scalarlejoinsel
);



--! @brief >= operator for ORE block types
--! @note FILE IS DISABLED - Not included in build
CREATE OPERATOR >= (
  FUNCTION=eql_v2.ore_block_u64_8_256_gte,
  LEFTARG=eql_v2.ore_block_u64_8_256,
  RIGHTARG=eql_v2.ore_block_u64_8_256,
  COMMUTATOR = <=,
  NEGATOR = <,
  RESTRICT = scalarlesel,
  JOIN = scalarlejoinsel
);
-- NOTE FILE IS DISABLED



--! @brief B-tree operator family for ORE block types
--!
--! Defines the operator family for creating B-tree indexes on ORE block types.
--!
--! @note FILE IS DISABLED - Not included in build
--! @see eql_v2.ore_block_u64_8_256_operator_class
CREATE OPERATOR FAMILY eql_v2.ore_block_u64_8_256_operator_family USING btree;

--! @brief B-tree operator class for ORE block encrypted values
--!
--! Defines the operator class required for creating B-tree indexes on columns
--! using the ore_block_u64_8_256 type. Enables range queries and ORDER BY on
--! ORE-encrypted data without decryption.
--!
--! Supports operators: <, <=, =, >=, >
--! Uses comparison function: compare_ore_block_u64_8_256_terms
--!
--! @note FILE IS DISABLED - Not included in build
--!
--! @example
--! -- Would be used like (if enabled):
--! CREATE INDEX ON events USING btree (
--!   (encrypted_timestamp::jsonb->'ob')::eql_v2.ore_block_u64_8_256
--! );
--!
--! @see CREATE OPERATOR CLASS in PostgreSQL documentation
--! @see eql_v2.compare_ore_block_u64_8_256_terms
CREATE OPERATOR CLASS eql_v2.ore_block_u64_8_256_operator_class DEFAULT FOR TYPE eql_v2.ore_block_u64_8_256 USING btree FAMILY eql_v2.ore_block_u64_8_256_operator_family  AS
        OPERATOR 1 <,
        OPERATOR 2 <=,
        OPERATOR 3 =,
        OPERATOR 4 >=,
        OPERATOR 5 >,
        FUNCTION 1 eql_v2.compare_ore_block_u64_8_256_terms(a eql_v2.ore_block_u64_8_256, b eql_v2.ore_block_u64_8_256);


--! @brief Compare two encrypted values using ORE block index terms
--!
--! Performs a three-way comparison (returns -1/0/1) of encrypted values using
--! their ORE block index terms. Used internally by range operators (<, <=, >, >=)
--! for order-revealing comparisons without decryption.
--!
--! @param a eql_v2_encrypted First encrypted value to compare
--! @param b eql_v2_encrypted Second encrypted value to compare
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b
--!
--! @note NULL values are sorted before non-NULL values
--! @note Uses ORE cryptographic protocol for secure comparisons
--!
--! @see eql_v2.ore_block_u64_8_256
--! @see eql_v2.has_ore_block_u64_8_256
--! @see eql_v2."<"
--! @see eql_v2.">"
CREATE FUNCTION eql_v2.compare_ore_block_u64_8_256(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS integer
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    a_term eql_v2.ore_block_u64_8_256;
    b_term eql_v2.ore_block_u64_8_256;
  BEGIN

    IF a IS NULL AND b IS NULL THEN
      RETURN 0;
    END IF;

    IF a IS NULL THEN
      RETURN -1;
    END IF;

    IF b IS NULL THEN
      RETURN 1;
    END IF;

    IF eql_v2.has_ore_block_u64_8_256(a) THEN
      a_term := eql_v2.ore_block_u64_8_256(a);
    END IF;

    IF eql_v2.has_ore_block_u64_8_256(a) THEN
      b_term := eql_v2.ore_block_u64_8_256(b);
    END IF;

    IF a_term IS NULL AND b_term IS NULL THEN
      RETURN 0;
    END IF;

    IF a_term IS NULL THEN
      RETURN -1;
    END IF;

    IF b_term IS NULL THEN
      RETURN 1;
    END IF;

    RETURN eql_v2.compare_ore_block_u64_8_256_terms(a_term.terms, b_term.terms);
  END;
$$ LANGUAGE plpgsql;


--! @brief Cast text to ORE block term
--! @internal
--!
--! Converts text to bytea and wraps in ore_block_u64_8_256_term type.
--! Used internally for ORE block extraction and manipulation.
--!
--! @param t Text Text value to convert
--! @return eql_v2.ore_block_u64_8_256_term ORE term containing bytea representation
--!
--! @see eql_v2.ore_block_u64_8_256_term
CREATE FUNCTION eql_v2.text_to_ore_block_u64_8_256_term(t text)
  RETURNS eql_v2.ore_block_u64_8_256_term
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
BEGIN ATOMIC
	RETURN t::bytea;
END;

--! @brief Implicit cast from text to ORE block term
--!
--! Defines an implicit cast allowing automatic conversion of text values
--! to ore_block_u64_8_256_term type for ORE operations.
--!
--! @see eql_v2.text_to_ore_block_u64_8_256_term
CREATE CAST (text AS eql_v2.ore_block_u64_8_256_term)
	WITH FUNCTION eql_v2.text_to_ore_block_u64_8_256_term(text) AS IMPLICIT;

--! @brief Pattern matching helper using bloom filters
--! @internal
--!
--! Internal helper for LIKE-style pattern matching on encrypted values.
--! Uses bloom filter index terms to test substring containment without decryption.
--! Requires 'match' index configuration on the column.
--!
--! @param a eql_v2_encrypted Haystack (value to search in)
--! @param b eql_v2_encrypted Needle (pattern to search for)
--! @return Boolean True if bloom filter of a contains bloom filter of b
--!
--! @see eql_v2."~~"
--! @see eql_v2.bloom_filter
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2.like(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean AS $$
  SELECT eql_v2.bloom_filter(a) @> eql_v2.bloom_filter(b);
$$ LANGUAGE SQL;

--! @brief Case-insensitive pattern matching helper
--! @internal
--!
--! Internal helper for ILIKE-style case-insensitive pattern matching.
--! Case sensitivity is controlled by index configuration (token_filters with downcase).
--! This function has same implementation as like() - actual case handling is in index terms.
--!
--! @param a eql_v2_encrypted Haystack (value to search in)
--! @param b eql_v2_encrypted Needle (pattern to search for)
--! @return Boolean True if bloom filter of a contains bloom filter of b
--!
--! @note Case sensitivity depends on match index token_filters configuration
--! @see eql_v2."~~"
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2.ilike(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean AS $$
  SELECT eql_v2.bloom_filter(a) @> eql_v2.bloom_filter(b);
$$ LANGUAGE SQL;

--! @brief LIKE operator for encrypted values (pattern matching)
--!
--! Implements the ~~ (LIKE) operator for substring/pattern matching on encrypted
--! text using bloom filter index terms. Enables WHERE col LIKE '%pattern%' queries
--! without decryption. Requires 'match' index configuration on the column.
--!
--! Pattern matching uses n-gram tokenization configured in match index. Token length
--! and filters affect matching behavior.
--!
--! @param a eql_v2_encrypted Haystack (encrypted text to search in)
--! @param b eql_v2_encrypted Needle (encrypted pattern to search for)
--! @return Boolean True if a contains b as substring
--!
--! @example
--! -- Search for substring in encrypted email
--! SELECT * FROM users
--! WHERE encrypted_email ~~ '%@example.com%'::text::eql_v2_encrypted;
--!
--! -- Pattern matching on encrypted names
--! SELECT * FROM customers
--! WHERE encrypted_name ~~ 'John%'::text::eql_v2_encrypted;
--!
--! @brief SQL LIKE operator (~~ operator) for encrypted text pattern matching
--!
--! @param a eql_v2_encrypted Left operand (encrypted value)
--! @param b eql_v2_encrypted Right operand (encrypted pattern)
--! @return boolean True if pattern matches
--!
--! @note Requires match index: eql_v2.add_search_config(table, column, 'match')
--! @see eql_v2.like
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2."~~"(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.like(a, b);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR ~~(
  FUNCTION=eql_v2."~~",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);

--! @brief Case-insensitive LIKE operator (~~*)
--!
--! Implements ~~* (ILIKE) operator for case-insensitive pattern matching.
--! Case handling depends on match index token_filters configuration (use downcase filter).
--! Same implementation as ~~, with case sensitivity controlled by index configuration.
--!
--! @param a eql_v2_encrypted Haystack
--! @param b eql_v2_encrypted Needle
--! @return Boolean True if a contains b (case-insensitive)
--!
--! @note Configure match index with downcase token filter for case-insensitivity
--! @see eql_v2."~~"
CREATE OPERATOR ~~*(
  FUNCTION=eql_v2."~~",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);

--! @brief LIKE operator for encrypted value and JSONB
--!
--! Overload of ~~ operator accepting JSONB on the right side. Automatically
--! casts JSONB to eql_v2_encrypted for bloom filter pattern matching.
--!
--! @param eql_v2_encrypted Haystack (encrypted value)
--! @param b JSONB Needle (will be cast to eql_v2_encrypted)
--! @return Boolean True if a contains b as substring
--!
--! @example
--! SELECT * FROM users WHERE encrypted_email ~~ '%gmail%'::jsonb;
--!
--! @see eql_v2."~~"(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."~~"(a eql_v2_encrypted, b jsonb)
  RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.like(a, b::eql_v2_encrypted);
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR ~~(
  FUNCTION=eql_v2."~~",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=jsonb,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);

CREATE OPERATOR ~~*(
  FUNCTION=eql_v2."~~",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=jsonb,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);

--! @brief LIKE operator for JSONB and encrypted value
--!
--! Overload of ~~ operator accepting JSONB on the left side. Automatically
--! casts JSONB to eql_v2_encrypted for bloom filter pattern matching.
--!
--! @param a JSONB Haystack (will be cast to eql_v2_encrypted)
--! @param eql_v2_encrypted Needle (encrypted pattern)
--! @return Boolean True if a contains b as substring
--!
--! @example
--! SELECT * FROM users WHERE 'test@example.com'::jsonb ~~ encrypted_pattern;
--!
--! @see eql_v2."~~"(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."~~"(a jsonb, b eql_v2_encrypted)
  RETURNS boolean
AS $$
  BEGIN
    RETURN eql_v2.like(a::eql_v2_encrypted, b);
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR ~~(
  FUNCTION=eql_v2."~~",
  LEFTARG=jsonb,
  RIGHTARG=eql_v2_encrypted,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);

CREATE OPERATOR ~~*(
  FUNCTION=eql_v2."~~",
  LEFTARG=jsonb,
  RIGHTARG=eql_v2_encrypted,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);


-- -----------------------------------------------------------------------------

--! @brief Extract ORE index term for ordering encrypted values
--!
--! Helper function that extracts the ore_block_u64_8_256 index term from an encrypted value
--! for use in ORDER BY clauses when comparison operators are not appropriate or available.
--!
--! @param eql_v2_encrypted Encrypted value to extract order term from
--! @return eql_v2.ore_block_u64_8_256 ORE index term for ordering
--!
--! @example
--! -- Order encrypted values without using comparison operators
--! SELECT * FROM users ORDER BY eql_v2.order_by(encrypted_age);
--!
--! @note Requires 'ore' index configuration on the column
--! @see eql_v2.ore_block_u64_8_256
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2.order_by(a eql_v2_encrypted)
  RETURNS eql_v2.ore_block_u64_8_256
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN eql_v2.ore_block_u64_8_256(a);
  END;
$$ LANGUAGE plpgsql;




--! @brief PostgreSQL operator class definitions for encrypted value indexing
--!
--! Defines the operator family and operator class required for btree indexing
--! of encrypted values. This enables PostgreSQL to use encrypted columns in:
--! - CREATE INDEX statements
--! - ORDER BY clauses
--! - Range queries
--! - Primary key constraints
--!
--! The operator class maps the five comparison operators (<, <=, =, >=, >)
--! to the eql_v2.compare() support function for btree index operations.
--!
--! @note This is the default operator class for eql_v2_encrypted type
--! @see eql_v2.compare
--! @see PostgreSQL documentation on operator classes

--------------------

CREATE OPERATOR FAMILY eql_v2.encrypted_operator_family USING btree;

CREATE OPERATOR CLASS eql_v2.encrypted_operator_class DEFAULT FOR TYPE eql_v2_encrypted USING btree FAMILY eql_v2.encrypted_operator_family AS
  OPERATOR 1 <,
  OPERATOR 2 <=,
  OPERATOR 3 =,
  OPERATOR 4 >=,
  OPERATOR 5 >,
  FUNCTION 1 eql_v2.compare(a eql_v2_encrypted, b eql_v2_encrypted);


--------------------

-- CREATE OPERATOR FAMILY eql_v2.encrypted_operator_ordered USING btree;

-- CREATE OPERATOR CLASS eql_v2.encrypted_operator_ordered FOR TYPE eql_v2_encrypted USING btree FAMILY eql_v2.encrypted_operator_ordered AS
--   OPERATOR 1 <,
--   OPERATOR 2 <=,
--   OPERATOR 3 =,
--   OPERATOR 4 >=,
--   OPERATOR 5 >,
--   FUNCTION 1 eql_v2.compare_ore_block_u64_8_256(a eql_v2_encrypted, b eql_v2_encrypted);

--------------------

-- CREATE OPERATOR FAMILY eql_v2.encrypted_hmac_256_operator USING btree;

-- CREATE OPERATOR CLASS eql_v2.encrypted_hmac_256_operator FOR TYPE eql_v2_encrypted USING btree FAMILY eql_v2.encrypted_hmac_256_operator AS
--   OPERATOR 1 <,
--   OPERATOR 2 <=,
--   OPERATOR 3 =,
--   OPERATOR 4 >=,
--   OPERATOR 5 >,
--   FUNCTION 1 eql_v2.compare_hmac(a eql_v2_encrypted, b eql_v2_encrypted);


--! @brief Contains operator for encrypted values (@>)
--!
--! Implements the @> (contains) operator for testing if left encrypted value
--! contains the right encrypted value. Uses ste_vec (secure tree encoding vector)
--! index terms for containment testing without decryption.
--!
--! Primarily used for encrypted array or set containment queries.
--!
--! @param a eql_v2_encrypted Left operand (container)
--! @param b eql_v2_encrypted Right operand (contained value)
--! @return Boolean True if a contains b
--!
--! @example
--! -- Check if encrypted array contains value
--! SELECT * FROM documents
--! WHERE encrypted_tags @> '["security"]'::jsonb::eql_v2_encrypted;
--!
--! @note Requires ste_vec index configuration
--! @see eql_v2.ste_vec_contains
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2."@>"(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean AS $$
  SELECT eql_v2.ste_vec_contains(a, b)
$$ LANGUAGE SQL;

CREATE OPERATOR @>(
  FUNCTION=eql_v2."@>",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted
);

--! @brief Contained-by operator for encrypted values (<@)
--!
--! Implements the <@ (contained-by) operator for testing if left encrypted value
--! is contained by the right encrypted value. Uses ste_vec (secure tree encoding vector)
--! index terms for containment testing without decryption. Reverse of @> operator.
--!
--! Primarily used for encrypted array or set containment queries.
--!
--! @param a eql_v2_encrypted Left operand (contained value)
--! @param b eql_v2_encrypted Right operand (container)
--! @return Boolean True if a is contained by b
--!
--! @example
--! -- Check if value is contained in encrypted array
--! SELECT * FROM documents
--! WHERE '["security"]'::jsonb::eql_v2_encrypted <@ encrypted_tags;
--!
--! @note Requires ste_vec index configuration
--! @see eql_v2.ste_vec_contains
--! @see eql_v2.\\"@>\\"
--! @see eql_v2.add_search_config

CREATE FUNCTION eql_v2."<@"(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS boolean AS $$
  -- Contains with reversed arguments
  SELECT eql_v2.ste_vec_contains(b, a)
$$ LANGUAGE SQL;

CREATE OPERATOR <@(
  FUNCTION=eql_v2."<@",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted
);

--! @brief Not-equal comparison helper for encrypted values
--! @internal
--!
--! Internal helper that delegates to eql_v2.compare for inequality testing.
--! Returns true if encrypted values are not equal via encrypted index comparison.
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return Boolean True if values are not equal (compare result <> 0)
--!
--! @see eql_v2.compare
--! @see eql_v2."<>"
CREATE FUNCTION eql_v2.neq(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN eql_v2.compare(a, b) <> 0;
  END;
$$ LANGUAGE plpgsql;

--! @brief Not-equal operator for encrypted values
--!
--! Implements the <> (not equal) operator for comparing encrypted values using their
--! encrypted index terms. Enables WHERE clause inequality comparisons without decryption.
--!
--! @param a eql_v2_encrypted Left operand
--! @param b eql_v2_encrypted Right operand
--! @return Boolean True if encrypted values are not equal
--!
--! @example
--! -- Find records with non-matching values
--! SELECT * FROM users
--! WHERE encrypted_email <> 'admin@example.com'::text::eql_v2_encrypted;
--!
--! @see eql_v2.compare
--! @see eql_v2."="
CREATE FUNCTION eql_v2."<>"(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN eql_v2.neq(a, b );
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR <> (
  FUNCTION=eql_v2."<>",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted,
  NEGATOR = =,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);

--! @brief <> operator for encrypted value and JSONB
--! @see eql_v2."<>"(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."<>"(a eql_v2_encrypted, b jsonb)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN eql_v2.neq(a, b::eql_v2_encrypted);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR <> (
  FUNCTION=eql_v2."<>",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=jsonb,
  NEGATOR = =,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);

--! @brief <> operator for JSONB and encrypted value
--!
--! @param jsonb Plain JSONB value
--! @param eql_v2_encrypted Encrypted value
--! @return boolean True if values are not equal
--!
--! @see eql_v2."<>"(eql_v2_encrypted, eql_v2_encrypted)
CREATE FUNCTION eql_v2."<>"(a jsonb, b eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN eql_v2.neq(a::eql_v2_encrypted, b);
  END;
$$ LANGUAGE plpgsql;

CREATE OPERATOR <> (
  FUNCTION=eql_v2."<>",
  LEFTARG=jsonb,
  RIGHTARG=eql_v2_encrypted,
  NEGATOR = =,
  RESTRICT = eqsel,
  JOIN = eqjoinsel,
  HASHES,
  MERGES
);





--! @brief JSONB field accessor operator alias (->>)
--!
--! Implements the ->> operator as an alias of -> for encrypted JSONB data. This mirrors
--! PostgreSQL semantics where ->> returns text via implicit casts. The underlying
--! implementation delegates to eql_v2."->" and allows PostgreSQL to coerce the result.
--!
--! Provides two overloads:
--! - (eql_v2_encrypted, text) - Field name selector
--! - (eql_v2_encrypted, eql_v2_encrypted) - Encrypted selector
--!
--! @see eql_v2."->"
--! @see eql_v2.selector

--! @brief ->> operator with text selector
--! @param eql_v2_encrypted Encrypted JSONB data
--! @param text Field name to extract
--! @return text Encrypted value at selector, implicitly cast from eql_v2_encrypted
--! @example
--! SELECT encrypted_json ->> 'field_name' FROM table;
CREATE FUNCTION eql_v2."->>"(e eql_v2_encrypted, selector text)
  RETURNS text
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    found eql_v2_encrypted;
	BEGIN
    -- found = eql_v2."->"(e, selector);
    -- RETURN eql_v2.ciphertext(found);
    RETURN eql_v2."->"(e, selector);
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR ->> (
  FUNCTION=eql_v2."->>",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=text
);



---------------------------------------------------

--! @brief ->> operator with encrypted selector
--! @param e eql_v2_encrypted Encrypted JSONB data
--! @param selector eql_v2_encrypted Encrypted field selector
--! @return text Encrypted value at selector, implicitly cast from eql_v2_encrypted
--! @see eql_v2."->>"(eql_v2_encrypted, text)
CREATE FUNCTION eql_v2."->>"(e eql_v2_encrypted, selector eql_v2_encrypted)
  RETURNS text
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2."->>"(e, eql_v2.selector(selector));
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR ->> (
  FUNCTION=eql_v2."->>",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted
);

--! @brief JSONB field accessor operator for encrypted values (->)
--!
--! Implements the -> operator to access fields/elements from encrypted JSONB data.
--! Returns encrypted value matching the provided selector without decryption.
--!
--! Encrypted JSON is represented as an array of eql_v2_encrypted values in the ste_vec format.
--! Each element has a selector, ciphertext, and index terms:
--!     {"sv": [{"c": "", "s": "", "b3": ""}]}
--!
--! Provides three overloads:
--! - (eql_v2_encrypted, text) - Field name selector
--! - (eql_v2_encrypted, eql_v2_encrypted) - Encrypted selector
--! - (eql_v2_encrypted, integer) - Array index selector (0-based)
--!
--! @note Operator resolution: Assignment casts are considered (PostgreSQL standard behavior).
--! To use text selector, parameter may need explicit cast to text.
--!
--! @see eql_v2.ste_vec
--! @see eql_v2.selector
--! @see eql_v2."->>"

--! @brief -> operator with text selector
--! @param eql_v2_encrypted Encrypted JSONB data
--! @param text Field name to extract
--! @return eql_v2_encrypted Encrypted value at selector
--! @example
--! SELECT encrypted_json -> 'field_name' FROM table;
CREATE FUNCTION eql_v2."->"(e eql_v2_encrypted, selector text)
  RETURNS eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    meta jsonb;
    sv eql_v2_encrypted[];
    found jsonb;
	BEGIN

    IF e IS NULL THEN
      RETURN NULL;
    END IF;

    -- Column identifier and version
    meta := eql_v2.meta_data(e);

    sv := eql_v2.ste_vec(e);

    FOR idx IN 1..array_length(sv, 1) LOOP
      if eql_v2.selector(sv[idx]) = selector THEN
        found := sv[idx];
      END IF;
    END LOOP;

    RETURN (meta || found)::eql_v2_encrypted;
  END;
$$ LANGUAGE plpgsql;


CREATE OPERATOR ->(
  FUNCTION=eql_v2."->",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=text
);

---------------------------------------------------

--! @brief -> operator with encrypted selector
--! @param e eql_v2_encrypted Encrypted JSONB data
--! @param selector eql_v2_encrypted Encrypted field selector
--! @return eql_v2_encrypted Encrypted value at selector
--! @see eql_v2."->"(eql_v2_encrypted, text)
CREATE FUNCTION eql_v2."->"(e eql_v2_encrypted, selector eql_v2_encrypted)
  RETURNS eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN
    RETURN eql_v2."->"(e, eql_v2.selector(selector));
  END;
$$ LANGUAGE plpgsql;



CREATE OPERATOR ->(
  FUNCTION=eql_v2."->",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=eql_v2_encrypted
);


---------------------------------------------------

--! @brief -> operator with integer array index
--! @param eql_v2_encrypted Encrypted array data
--! @param integer Array index (0-based, JSONB convention)
--! @return eql_v2_encrypted Encrypted value at array index
--! @note Array index is 0-based (JSONB standard) despite PostgreSQL arrays being 1-based
--! @example
--! SELECT encrypted_array -> 0 FROM table;
--! @see eql_v2.is_ste_vec_array
CREATE FUNCTION eql_v2."->"(e eql_v2_encrypted, selector integer)
  RETURNS eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    sv eql_v2_encrypted[];
    found eql_v2_encrypted;
	BEGIN
    IF NOT eql_v2.is_ste_vec_array(e) THEN
      RETURN NULL;
    END IF;

    sv := eql_v2.ste_vec(e);

    -- PostgreSQL arrays are 1-based
    -- JSONB arrays are 0-based and so the selector is 0-based
    FOR idx IN 1..array_length(sv, 1) LOOP
      if (idx-1) = selector THEN
        found := sv[idx];
      END IF;
    END LOOP;

    RETURN found;
  END;
$$ LANGUAGE plpgsql;





CREATE OPERATOR ->(
  FUNCTION=eql_v2."->",
  LEFTARG=eql_v2_encrypted,
  RIGHTARG=integer
);


--! @file jsonb/functions.sql
--! @brief JSONB path query and array manipulation functions for encrypted data
--!
--! These functions provide PostgreSQL-compatible operations on encrypted JSONB values
--! using Structured Transparent Encryption (STE). They support:
--! - Path-based queries to extract nested encrypted values
--! - Existence checks for encrypted fields
--! - Array operations (length, elements extraction)
--!
--! @note STE stores encrypted JSONB as a vector of encrypted elements ('sv') with selectors
--! @note Functions suppress errors for missing fields, type mismatches (similar to PostgreSQL jsonpath)


--! @brief Query encrypted JSONB for elements matching selector
--!
--! Searches the Structured Transparent Encryption (STE) vector for elements matching
--! the given selector path. Returns all matching encrypted elements. If multiple
--! matches form an array, they are wrapped with array metadata.
--!
--! @param jsonb Encrypted JSONB payload containing STE vector ('sv')
--! @param text Path selector to match against encrypted elements
--! @return SETOF eql_v2_encrypted Matching encrypted elements (may return multiple rows)
--!
--! @note Returns empty set if selector is not found (does not throw exception)
--! @note Array elements use same selector; multiple matches wrapped with 'a' flag
--! @note Returns a set containing NULL if val is NULL; returns empty set if no matches found
--! @see eql_v2.jsonb_path_query_first
--! @see eql_v2.jsonb_path_exists
CREATE FUNCTION eql_v2.jsonb_path_query(val jsonb, selector text)
  RETURNS SETOF eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    sv eql_v2_encrypted[];
    found jsonb[];
    e jsonb;
    meta jsonb;
    ary boolean;
  BEGIN

    IF val IS NULL THEN
      RETURN NEXT NULL;
    END IF;

    -- Column identifier and version
    meta := eql_v2.meta_data(val);

    sv := eql_v2.ste_vec(val);

    FOR idx IN 1..array_length(sv, 1) LOOP
      e := sv[idx];

      IF eql_v2.selector(e) = selector THEN
        found := array_append(found, e);
        IF eql_v2.is_ste_vec_array(e) THEN
          ary := true;
        END IF;

      END IF;
    END LOOP;

    IF found IS NOT NULL THEN

      IF ary THEN
        -- Wrap found array elements as eql_v2_encrypted

        RETURN NEXT (meta || jsonb_build_object(
          'sv', found,
          'a', 1
        ))::eql_v2_encrypted;

      ELSE
        RETURN NEXT (meta || found[1])::eql_v2_encrypted;
      END IF;

    END IF;

    RETURN;
  END;
$$ LANGUAGE plpgsql;


--! @brief Query encrypted JSONB with encrypted selector
--!
--! Overload that accepts encrypted selector and extracts its plaintext value
--! before delegating to main jsonb_path_query implementation.
--!
--! @param val eql_v2_encrypted Encrypted JSONB value to query
--! @param selector eql_v2_encrypted Encrypted selector to match against
--! @return SETOF eql_v2_encrypted Matching encrypted elements
--!
--! @see eql_v2.jsonb_path_query(jsonb, text)
CREATE FUNCTION eql_v2.jsonb_path_query(val eql_v2_encrypted, selector eql_v2_encrypted)
  RETURNS SETOF eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN QUERY
    SELECT * FROM eql_v2.jsonb_path_query(val.data, eql_v2.selector(selector));
  END;
$$ LANGUAGE plpgsql;


--! @brief Query encrypted JSONB with text selector
--!
--! Overload that accepts encrypted JSONB value and text selector,
--! extracting the JSONB payload before querying.
--!
--! @param eql_v2_encrypted Encrypted JSONB value to query
--! @param text Path selector to match against
--! @return SETOF eql_v2_encrypted Matching encrypted elements
--!
--! @example
--! -- Query encrypted JSONB for specific field
--! SELECT * FROM eql_v2.jsonb_path_query(encrypted_document, '$.address.city');
--!
--! @see eql_v2.jsonb_path_query(jsonb, text)
CREATE FUNCTION eql_v2.jsonb_path_query(val eql_v2_encrypted, selector text)
  RETURNS SETOF eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN QUERY
    SELECT * FROM eql_v2.jsonb_path_query(val.data, selector);
  END;
$$ LANGUAGE plpgsql;


------------------------------------------------------------------------------------


--! @brief Check if selector path exists in encrypted JSONB
--!
--! Tests whether any encrypted elements match the given selector path.
--! More efficient than jsonb_path_query when only existence check is needed.
--!
--! @param jsonb Encrypted JSONB payload to check
--! @param text Path selector to test
--! @return boolean True if matching element exists, false otherwise
--!
--! @see eql_v2.jsonb_path_query(jsonb, text)
CREATE FUNCTION eql_v2.jsonb_path_exists(val jsonb, selector text)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN EXISTS (
      SELECT eql_v2.jsonb_path_query(val, selector)
    );
  END;
$$ LANGUAGE plpgsql;


--! @brief Check existence with encrypted selector
--!
--! Overload that accepts encrypted selector and extracts its value
--! before checking existence.
--!
--! @param val eql_v2_encrypted Encrypted JSONB value to check
--! @param selector eql_v2_encrypted Encrypted selector to test
--! @return boolean True if path exists
--!
--! @see eql_v2.jsonb_path_exists(jsonb, text)
CREATE FUNCTION eql_v2.jsonb_path_exists(val eql_v2_encrypted, selector eql_v2_encrypted)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN EXISTS (
      SELECT eql_v2.jsonb_path_query(val, eql_v2.selector(selector))
    );
  END;
$$ LANGUAGE plpgsql;


--! @brief Check existence with text selector
--!
--! Overload that accepts encrypted JSONB value and text selector.
--!
--! @param eql_v2_encrypted Encrypted JSONB value to check
--! @param text Path selector to test
--! @return boolean True if path exists
--!
--! @example
--! -- Check if encrypted document has address field
--! SELECT eql_v2.jsonb_path_exists(encrypted_document, '$.address');
--!
--! @see eql_v2.jsonb_path_exists(jsonb, text)
CREATE FUNCTION eql_v2.jsonb_path_exists(val eql_v2_encrypted, selector text)
  RETURNS boolean
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN EXISTS (
      SELECT eql_v2.jsonb_path_query(val, selector)
    );
  END;
$$ LANGUAGE plpgsql;


------------------------------------------------------------------------------------


--! @brief Get first element matching selector
--!
--! Returns only the first encrypted element matching the selector path,
--! or NULL if no match found. More efficient than jsonb_path_query when
--! only one result is needed.
--!
--! @param jsonb Encrypted JSONB payload to query
--! @param text Path selector to match
--! @return eql_v2_encrypted First matching element or NULL
--!
--! @note Uses LIMIT 1 internally for efficiency
--! @see eql_v2.jsonb_path_query(jsonb, text)
CREATE FUNCTION eql_v2.jsonb_path_query_first(val jsonb, selector text)
  RETURNS eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (
      SELECT e
      FROM eql_v2.jsonb_path_query(val, selector) AS e
      LIMIT 1
    );
  END;
$$ LANGUAGE plpgsql;


--! @brief Get first element with encrypted selector
--!
--! Overload that accepts encrypted selector and extracts its value
--! before querying for first match.
--!
--! @param val eql_v2_encrypted Encrypted JSONB value to query
--! @param selector eql_v2_encrypted Encrypted selector to match
--! @return eql_v2_encrypted First matching element or NULL
--!
--! @see eql_v2.jsonb_path_query_first(jsonb, text)
CREATE FUNCTION eql_v2.jsonb_path_query_first(val eql_v2_encrypted, selector eql_v2_encrypted)
  RETURNS eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (
      SELECT e
      FROM eql_v2.jsonb_path_query(val.data, eql_v2.selector(selector)) AS e
      LIMIT 1
    );
  END;
$$ LANGUAGE plpgsql;


--! @brief Get first element with text selector
--!
--! Overload that accepts encrypted JSONB value and text selector.
--!
--! @param eql_v2_encrypted Encrypted JSONB value to query
--! @param text Path selector to match
--! @return eql_v2_encrypted First matching element or NULL
--!
--! @example
--! -- Get first matching address from encrypted document
--! SELECT eql_v2.jsonb_path_query_first(encrypted_document, '$.addresses[*]');
--!
--! @see eql_v2.jsonb_path_query_first(jsonb, text)
CREATE FUNCTION eql_v2.jsonb_path_query_first(val eql_v2_encrypted, selector text)
  RETURNS eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (
      SELECT e
      FROM eql_v2.jsonb_path_query(val.data, selector) AS e
      LIMIT 1
    );
  END;
$$ LANGUAGE plpgsql;



------------------------------------------------------------------------------------


--! @brief Get length of encrypted JSONB array
--!
--! Returns the number of elements in an encrypted JSONB array by counting
--! elements in the STE vector ('sv'). The encrypted value must have the
--! array flag ('a') set to true.
--!
--! @param jsonb Encrypted JSONB payload representing an array
--! @return integer Number of elements in the array
--! @throws Exception 'cannot get array length of a non-array' if 'a' flag is missing or not true
--!
--! @note Array flag 'a' must be present and set to true value
--! @see eql_v2.jsonb_array_elements
CREATE FUNCTION eql_v2.jsonb_array_length(val jsonb)
  RETURNS integer
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    sv eql_v2_encrypted[];
    found eql_v2_encrypted[];
  BEGIN

    IF val IS NULL THEN
      RETURN NULL;
    END IF;

    IF eql_v2.is_ste_vec_array(val) THEN
      sv := eql_v2.ste_vec(val);
      RETURN array_length(sv, 1);
    END IF;

    RAISE 'cannot get array length of a non-array';
  END;
$$ LANGUAGE plpgsql;


--! @brief Get array length from encrypted type
--!
--! Overload that accepts encrypted composite type and extracts the
--! JSONB payload before computing array length.
--!
--! @param eql_v2_encrypted Encrypted array value
--! @return integer Number of elements in the array
--! @throws Exception if value is not an array
--!
--! @example
--! -- Get length of encrypted array
--! SELECT eql_v2.jsonb_array_length(encrypted_tags);
--!
--! @see eql_v2.jsonb_array_length(jsonb)
CREATE FUNCTION eql_v2.jsonb_array_length(val eql_v2_encrypted)
  RETURNS integer
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN (
      SELECT eql_v2.jsonb_array_length(val.data)
    );
  END;
$$ LANGUAGE plpgsql;




--! @brief Extract elements from encrypted JSONB array
--!
--! Returns each element of an encrypted JSONB array as a separate row.
--! Each element is returned as an eql_v2_encrypted value with metadata
--! preserved from the parent array.
--!
--! @param jsonb Encrypted JSONB payload representing an array
--! @return SETOF eql_v2_encrypted One row per array element
--! @throws Exception if value is not an array (missing 'a' flag)
--!
--! @note Each element inherits metadata (version, ident) from parent
--! @see eql_v2.jsonb_array_length
--! @see eql_v2.jsonb_array_elements_text
CREATE FUNCTION eql_v2.jsonb_array_elements(val jsonb)
  RETURNS SETOF eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    sv eql_v2_encrypted[];
    meta jsonb;
    item jsonb;
  BEGIN

    IF NOT eql_v2.is_ste_vec_array(val) THEN
      RAISE 'cannot extract elements from non-array';
    END IF;

    -- Column identifier and version
    meta := eql_v2.meta_data(val);

    sv := eql_v2.ste_vec(val);

    FOR idx IN 1..array_length(sv, 1) LOOP
      item = sv[idx];
      RETURN NEXT (meta || item)::eql_v2_encrypted;
    END LOOP;

    RETURN;
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract elements from encrypted array type
--!
--! Overload that accepts encrypted composite type and extracts each
--! array element as a separate row.
--!
--! @param eql_v2_encrypted Encrypted array value
--! @return SETOF eql_v2_encrypted One row per array element
--! @throws Exception if value is not an array
--!
--! @example
--! -- Expand encrypted array into rows
--! SELECT * FROM eql_v2.jsonb_array_elements(encrypted_tags);
--!
--! @see eql_v2.jsonb_array_elements(jsonb)
CREATE FUNCTION eql_v2.jsonb_array_elements(val eql_v2_encrypted)
  RETURNS SETOF eql_v2_encrypted
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN QUERY
      SELECT * FROM eql_v2.jsonb_array_elements(val.data);
  END;
$$ LANGUAGE plpgsql;



--! @brief Extract encrypted array elements as ciphertext
--!
--! Returns each element of an encrypted JSONB array as its raw ciphertext
--! value (text representation). Unlike jsonb_array_elements, this returns
--! only the ciphertext 'c' field without metadata.
--!
--! @param jsonb Encrypted JSONB payload representing an array
--! @return SETOF text One ciphertext string per array element
--! @throws Exception if value is not an array (missing 'a' flag)
--!
--! @note Returns ciphertext only, not full encrypted structure
--! @see eql_v2.jsonb_array_elements
CREATE FUNCTION eql_v2.jsonb_array_elements_text(val jsonb)
  RETURNS SETOF text
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    sv eql_v2_encrypted[];
    found eql_v2_encrypted[];
  BEGIN
    IF NOT eql_v2.is_ste_vec_array(val) THEN
      RAISE 'cannot extract elements from non-array';
    END IF;

    sv := eql_v2.ste_vec(val);

    FOR idx IN 1..array_length(sv, 1) LOOP
      RETURN NEXT eql_v2.ciphertext(sv[idx]);
    END LOOP;

    RETURN;
  END;
$$ LANGUAGE plpgsql;


--! @brief Extract array elements as ciphertext from encrypted type
--!
--! Overload that accepts encrypted composite type and extracts each
--! array element's ciphertext as text.
--!
--! @param eql_v2_encrypted Encrypted array value
--! @return SETOF text One ciphertext string per array element
--! @throws Exception if value is not an array
--!
--! @example
--! -- Get ciphertext of each array element
--! SELECT * FROM eql_v2.jsonb_array_elements_text(encrypted_tags);
--!
--! @see eql_v2.jsonb_array_elements_text(jsonb)
CREATE FUNCTION eql_v2.jsonb_array_elements_text(val eql_v2_encrypted)
  RETURNS SETOF text
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN QUERY
      SELECT * FROM eql_v2.jsonb_array_elements_text(val.data);
  END;
$$ LANGUAGE plpgsql;


--! @brief Compare two encrypted values using HMAC-SHA256 index terms
--!
--! Performs a three-way comparison (returns -1/0/1) of encrypted values using
--! their HMAC-SHA256 hash index terms. Used internally by the equality operator (=)
--! for exact-match queries without decryption.
--!
--! @param a eql_v2_encrypted First encrypted value to compare
--! @param b eql_v2_encrypted Second encrypted value to compare
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b
--!
--! @note NULL values are sorted before non-NULL values
--! @note Comparison uses underlying text type ordering of HMAC-SHA256 hashes
--!
--! @see eql_v2.hmac_256
--! @see eql_v2.has_hmac_256
--! @see eql_v2."="
CREATE FUNCTION eql_v2.compare_hmac_256(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS integer
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    a_term eql_v2.hmac_256;
    b_term eql_v2.hmac_256;
  BEGIN

    IF a IS NULL AND b IS NULL THEN
      RETURN 0;
    END IF;

    IF a IS NULL THEN
      RETURN -1;
    END IF;

    IF b IS NULL THEN
      RETURN 1;
    END IF;

    IF eql_v2.has_hmac_256(a) THEN
      a_term = eql_v2.hmac_256(a);
    END IF;

    IF eql_v2.has_hmac_256(b) THEN
      b_term = eql_v2.hmac_256(b);
    END IF;

    IF a_term IS NULL AND b_term IS NULL THEN
      RETURN 0;
    END IF;

    IF a_term IS NULL THEN
      RETURN -1;
    END IF;

    IF b_term IS NULL THEN
      RETURN 1;
    END IF;

    -- Using the underlying text type comparison
    IF a_term = b_term THEN
      RETURN 0;
    END IF;

    IF a_term < b_term THEN
      RETURN -1;
    END IF;

    IF a_term > b_term THEN
      RETURN 1;
    END IF;

  END;
$$ LANGUAGE plpgsql;
--! @file encryptindex/functions.sql
--! @brief Configuration lifecycle and column encryption management
--!
--! Provides functions for managing encryption configuration transitions:
--! - Comparing configurations to identify changes
--! - Identifying columns needing encryption
--! - Creating and renaming encrypted columns during initial setup
--! - Tracking encryption progress
--!
--! These functions support the workflow of activating a pending configuration
--! and performing the initial encryption of plaintext columns.


--! @brief Compare two configurations and find differences
--! @internal
--!
--! Returns table/column pairs where configuration differs between two configs.
--! Used to identify which columns need encryption when activating a pending config.
--!
--! @param a jsonb First configuration to compare
--! @param b jsonb Second configuration to compare
--! @return TABLE(table_name text, column_name text) Columns with differing configuration
--!
--! @note Compares configuration structure, not just presence/absence
--! @see eql_v2.select_pending_columns
CREATE FUNCTION eql_v2.diff_config(a JSONB, b JSONB)
	RETURNS TABLE(table_name TEXT, column_name TEXT)
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  BEGIN
    RETURN QUERY
    WITH table_keys AS (
      SELECT jsonb_object_keys(a->'tables') AS key
      UNION
      SELECT jsonb_object_keys(b->'tables') AS key
    ),
    column_keys AS (
      SELECT tk.key AS table_key, jsonb_object_keys(a->'tables'->tk.key) AS column_key
      FROM table_keys tk
      UNION
      SELECT tk.key AS table_key, jsonb_object_keys(b->'tables'->tk.key) AS column_key
      FROM table_keys tk
    )
    SELECT
      ck.table_key AS table_name,
      ck.column_key AS column_name
    FROM
      column_keys ck
    WHERE
      (a->'tables'->ck.table_key->ck.column_key IS DISTINCT FROM b->'tables'->ck.table_key->ck.column_key);
  END;
$$ LANGUAGE plpgsql;


--! @brief Get columns with pending configuration changes
--!
--! Compares 'pending' and 'active' configurations to identify columns that need
--! encryption or re-encryption. Returns columns where configuration differs.
--!
--! @return TABLE(table_name text, column_name text) Columns needing encryption
--! @throws Exception if no pending configuration exists
--!
--! @note Treats missing active config as empty config
--! @see eql_v2.diff_config
--! @see eql_v2.select_target_columns
CREATE FUNCTION eql_v2.select_pending_columns()
	RETURNS TABLE(table_name TEXT, column_name TEXT)
AS $$
	DECLARE
		active JSONB;
		pending JSONB;
		config_id BIGINT;
	BEGIN
		SELECT data INTO active FROM eql_v2_configuration WHERE state = 'active';

		-- set default config
    IF active IS NULL THEN
      active := '{}';
    END IF;

		SELECT id, data INTO config_id, pending FROM eql_v2_configuration WHERE state = 'pending';

		-- set default config
		IF config_id IS NULL THEN
			RAISE EXCEPTION 'No pending configuration exists to encrypt';
		END IF;

		RETURN QUERY
		SELECT d.table_name, d.column_name FROM eql_v2.diff_config(active, pending) as d;
	END;
$$ LANGUAGE plpgsql;


--! @brief Map pending columns to their encrypted target columns
--!
--! For each column with pending configuration, identifies the corresponding
--! encrypted column. During initial encryption, target is '{column_name}_encrypted'.
--! Returns NULL for target_column if encrypted column doesn't exist yet.
--!
--! @return TABLE(table_name text, column_name text, target_column text) Column mappings
--!
--! @note Target column is NULL if no column exists matching either 'column_name' or 'column_name_encrypted' with type eql_v2_encrypted
--! @note The LEFT JOIN checks both original and '_encrypted' suffix variations with type verification
--! @see eql_v2.select_pending_columns
--! @see eql_v2.create_encrypted_columns
CREATE FUNCTION eql_v2.select_target_columns()
	RETURNS TABLE(table_name TEXT, column_name TEXT, target_column TEXT)
	STABLE STRICT PARALLEL SAFE
AS $$
  SELECT
    c.table_name,
    c.column_name,
    s.column_name as target_column
  FROM
    eql_v2.select_pending_columns() c
  LEFT JOIN information_schema.columns s ON
    s.table_name = c.table_name AND
    (s.column_name = c.column_name OR s.column_name = c.column_name || '_encrypted') AND
    s.udt_name = 'eql_v2_encrypted';
$$ LANGUAGE sql;


--! @brief Check if database is ready for encryption
--!
--! Verifies that all columns with pending configuration have corresponding
--! encrypted target columns created. Returns true if encryption can proceed.
--!
--! @return boolean True if all pending columns have target encrypted columns
--!
--! @note Returns false if any pending column lacks encrypted column
--! @see eql_v2.select_target_columns
--! @see eql_v2.create_encrypted_columns
CREATE FUNCTION eql_v2.ready_for_encryption()
	RETURNS BOOLEAN
	STABLE STRICT PARALLEL SAFE
AS $$
	SELECT EXISTS (
	  SELECT *
	  FROM eql_v2.select_target_columns() AS c
	  WHERE c.target_column IS NOT NULL);
$$ LANGUAGE sql;


--! @brief Create encrypted columns for initial encryption
--!
--! For each plaintext column with pending configuration that lacks an encrypted
--! target column, creates a new column '{column_name}_encrypted' of type
--! eql_v2_encrypted. This prepares the database schema for initial encryption.
--!
--! @return TABLE(table_name text, column_name text) Created encrypted columns
--!
--! @warning Executes dynamic DDL (ALTER TABLE ADD COLUMN) - modifies database schema
--! @note Only creates columns that don't already exist
--! @see eql_v2.select_target_columns
--! @see eql_v2.rename_encrypted_columns
CREATE FUNCTION eql_v2.create_encrypted_columns()
	RETURNS TABLE(table_name TEXT, column_name TEXT)
AS $$
	BEGIN
    FOR table_name, column_name IN
      SELECT c.table_name, (c.column_name || '_encrypted') FROM eql_v2.select_target_columns() AS c WHERE c.target_column IS NULL
    LOOP
		  EXECUTE format('ALTER TABLE %I ADD column %I eql_v2_encrypted;', table_name, column_name);
      RETURN NEXT;
    END LOOP;
	END;
$$ LANGUAGE plpgsql;


--! @brief Finalize initial encryption by renaming columns
--!
--! After initial encryption completes, renames columns to complete the transition:
--! - Plaintext column '{column_name}' → '{column_name}_plaintext'
--! - Encrypted column '{column_name}_encrypted' → '{column_name}'
--!
--! This makes the encrypted column the primary column with the original name.
--!
--! @return TABLE(table_name text, column_name text, target_column text) Renamed columns
--!
--! @warning Executes dynamic DDL (ALTER TABLE RENAME COLUMN) - modifies database schema
--! @note Only renames columns where target is '{column_name}_encrypted'
--! @see eql_v2.create_encrypted_columns
CREATE FUNCTION eql_v2.rename_encrypted_columns()
	RETURNS TABLE(table_name TEXT, column_name TEXT, target_column TEXT)
AS $$
	BEGIN
    FOR table_name, column_name, target_column IN
      SELECT * FROM eql_v2.select_target_columns() as c WHERE c.target_column = c.column_name || '_encrypted'
    LOOP
		  EXECUTE format('ALTER TABLE %I RENAME %I TO %I;', table_name, column_name, column_name || '_plaintext');
		  EXECUTE format('ALTER TABLE %I RENAME %I TO %I;', table_name, target_column, column_name);
      RETURN NEXT;
    END LOOP;
	END;
$$ LANGUAGE plpgsql;


--! @brief Count rows encrypted with active configuration
--! @internal
--!
--! Counts rows in a table where the encrypted column was encrypted using
--! the currently active configuration. Used to track encryption progress.
--!
--! @param table_name text Name of table to check
--! @param column_name text Name of encrypted column to check
--! @return bigint Count of rows encrypted with active configuration
--!
--! @note The 'v' field in encrypted payloads stores the payload version ("2"), not the configuration ID
--! @note Configuration tracking mechanism is implementation-specific
CREATE FUNCTION eql_v2.count_encrypted_with_active_config(table_name TEXT, column_name TEXT)
  RETURNS BIGINT
AS $$
DECLARE
  result BIGINT;
BEGIN
	EXECUTE format(
        'SELECT COUNT(%I) FROM %s t WHERE %I->>%L = (SELECT id::TEXT FROM eql_v2_configuration WHERE state = %L)',
        column_name, table_name, column_name, 'v', 'active'
    )
	INTO result;
  	RETURN result;
END;
$$ LANGUAGE plpgsql;



--! @brief Validate presence of ident field in encrypted payload
--! @internal
--!
--! Checks that the encrypted JSONB payload contains the required 'i' (ident) field.
--! The ident field tracks which table and column the encrypted value belongs to.
--!
--! @param jsonb Encrypted payload to validate
--! @return Boolean True if 'i' field is present
--! @throws Exception if 'i' field is missing
--!
--! @note Used in CHECK constraints to ensure payload structure
--! @see eql_v2.check_encrypted
CREATE FUNCTION eql_v2._encrypted_check_i(val jsonb)
  RETURNS boolean
AS $$
	BEGIN
    IF val ? 'i' THEN
      RETURN true;
    END IF;
    RAISE 'Encrypted column missing ident (i) field: %', val;
  END;
$$ LANGUAGE plpgsql;


--! @brief Validate table and column fields in ident
--! @internal
--!
--! Checks that the 'i' (ident) field contains both 't' (table) and 'c' (column)
--! subfields, which identify the origin of the encrypted value.
--!
--! @param jsonb Encrypted payload to validate
--! @return Boolean True if both 't' and 'c' subfields are present
--! @throws Exception if 't' or 'c' subfields are missing
--!
--! @note Used in CHECK constraints to ensure payload structure
--! @see eql_v2.check_encrypted
CREATE FUNCTION eql_v2._encrypted_check_i_ct(val jsonb)
  RETURNS boolean
AS $$
	BEGIN
    IF (val->'i' ?& array['t', 'c']) THEN
      RETURN true;
    END IF;
    RAISE 'Encrypted column ident (i) missing table (t) or column (c) fields: %', val;
  END;
$$ LANGUAGE plpgsql;

--! @brief Validate version field in encrypted payload
--! @internal
--!
--! Checks that the encrypted payload has version field 'v' set to '2',
--! the current EQL v2 payload version.
--!
--! @param jsonb Encrypted payload to validate
--! @return Boolean True if 'v' field is present and equals '2'
--! @throws Exception if 'v' field is missing or not '2'
--!
--! @note Used in CHECK constraints to ensure payload structure
--! @see eql_v2.check_encrypted
CREATE FUNCTION eql_v2._encrypted_check_v(val jsonb)
  RETURNS boolean
AS $$
	BEGIN
    IF (val ? 'v') THEN

      IF val->>'v' <> '2' THEN
        RAISE 'Expected encrypted column version (v) 2';
        RETURN false;
      END IF;

      RETURN true;
    END IF;
    RAISE 'Encrypted column missing version (v) field: %', val;
  END;
$$ LANGUAGE plpgsql;


--! @brief Validate ciphertext field in encrypted payload
--! @internal
--!
--! Checks that the encrypted payload contains the required 'c' (ciphertext) field
--! which stores the encrypted data.
--!
--! @param jsonb Encrypted payload to validate
--! @return Boolean True if 'c' field is present
--! @throws Exception if 'c' field is missing
--!
--! @note Used in CHECK constraints to ensure payload structure
--! @see eql_v2.check_encrypted
CREATE FUNCTION eql_v2._encrypted_check_c(val jsonb)
  RETURNS boolean
AS $$
	BEGIN
    IF (val ? 'c') THEN
      RETURN true;
    END IF;
    RAISE 'Encrypted column missing ciphertext (c) field: %', val;
  END;
$$ LANGUAGE plpgsql;


--! @brief Validate complete encrypted payload structure
--!
--! Comprehensive validation function that checks all required fields in an
--! encrypted JSONB payload: version ('v'), ciphertext ('c'), ident ('i'),
--! and ident subfields ('t', 'c').
--!
--! This function is used in CHECK constraints to ensure encrypted column
--! data integrity at the database level.
--!
--! @param jsonb Encrypted payload to validate
--! @return Boolean True if all structure checks pass
--! @throws Exception if any required field is missing or invalid
--!
--! @example
--! -- Add validation constraint to encrypted column
--! ALTER TABLE users ADD CONSTRAINT check_email_encrypted
--!   CHECK (eql_v2.check_encrypted(encrypted_email::jsonb));
--!
--! @see eql_v2._encrypted_check_v
--! @see eql_v2._encrypted_check_c
--! @see eql_v2._encrypted_check_i
--! @see eql_v2._encrypted_check_i_ct
CREATE FUNCTION eql_v2.check_encrypted(val jsonb)
  RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
BEGIN ATOMIC
    RETURN (
      eql_v2._encrypted_check_v(val) AND
      eql_v2._encrypted_check_c(val) AND
      eql_v2._encrypted_check_i(val) AND
      eql_v2._encrypted_check_i_ct(val)
    );
END;


--! @brief Validate encrypted composite type structure
--!
--! Validates an eql_v2_encrypted composite type by checking its underlying
--! JSONB payload. Delegates to eql_v2.check_encrypted(jsonb).
--!
--! @param eql_v2_encrypted Encrypted value to validate
--! @return Boolean True if structure is valid
--! @throws Exception if any required field is missing or invalid
--!
--! @see eql_v2.check_encrypted(jsonb)
CREATE FUNCTION eql_v2.check_encrypted(val eql_v2_encrypted)
  RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
BEGIN ATOMIC
    RETURN eql_v2.check_encrypted(val.data);
END;


-- Aggregate functions for ORE

--! @brief State transition function for min aggregate
--! @internal
--!
--! Returns the smaller of two encrypted values for use in MIN aggregate.
--! Comparison uses ORE index terms without decryption.
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return eql_v2_encrypted The smaller of the two values
--!
--! @see eql_v2.min(eql_v2_encrypted)
CREATE FUNCTION eql_v2.min(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS eql_v2_encrypted
STRICT
AS $$
  BEGIN
    IF a < b THEN
      RETURN a;
    ELSE
      RETURN b;
    END IF;
  END;
$$ LANGUAGE plpgsql;


--! @brief Find minimum encrypted value in a group
--!
--! Aggregate function that returns the minimum encrypted value in a group
--! using ORE index term comparisons without decryption.
--!
--! @param input eql_v2_encrypted Encrypted values to aggregate
--! @return eql_v2_encrypted Minimum value in the group
--!
--! @example
--! -- Find minimum age per department
--! SELECT department, eql_v2.min(encrypted_age)
--! FROM employees
--! GROUP BY department;
--!
--! @note Requires 'ore' index configuration on the column
--! @see eql_v2.min(eql_v2_encrypted, eql_v2_encrypted)
CREATE AGGREGATE eql_v2.min(eql_v2_encrypted)
(
  sfunc = eql_v2.min,
  stype = eql_v2_encrypted
);


--! @brief State transition function for max aggregate
--! @internal
--!
--! Returns the larger of two encrypted values for use in MAX aggregate.
--! Comparison uses ORE index terms without decryption.
--!
--! @param a eql_v2_encrypted First encrypted value
--! @param b eql_v2_encrypted Second encrypted value
--! @return eql_v2_encrypted The larger of the two values
--!
--! @see eql_v2.max(eql_v2_encrypted)
CREATE FUNCTION eql_v2.max(a eql_v2_encrypted, b eql_v2_encrypted)
RETURNS eql_v2_encrypted
STRICT
AS $$
  BEGIN
    IF a > b THEN
      RETURN a;
    ELSE
      RETURN b;
    END IF;
  END;
$$ LANGUAGE plpgsql;


--! @brief Find maximum encrypted value in a group
--!
--! Aggregate function that returns the maximum encrypted value in a group
--! using ORE index term comparisons without decryption.
--!
--! @param input eql_v2_encrypted Encrypted values to aggregate
--! @return eql_v2_encrypted Maximum value in the group
--!
--! @example
--! -- Find maximum salary per department
--! SELECT department, eql_v2.max(encrypted_salary)
--! FROM employees
--! GROUP BY department;
--!
--! @note Requires 'ore' index configuration on the column
--! @see eql_v2.max(eql_v2_encrypted, eql_v2_encrypted)
CREATE AGGREGATE eql_v2.max(eql_v2_encrypted)
(
  sfunc = eql_v2.max,
  stype = eql_v2_encrypted
);


--! @file config/indexes.sql
--! @brief Configuration state uniqueness indexes
--!
--! Creates partial unique indexes to enforce that only one configuration
--! can be in 'active', 'pending', or 'encrypting' state at any time.
--! Multiple 'inactive' configurations are allowed.
--!
--! @note Uses partial indexes (WHERE clauses) for efficiency
--! @note Prevents conflicting configurations from being active simultaneously
--! @see config/types.sql for state definitions


--! @brief Unique active configuration constraint
--! @note Only one configuration can be 'active' at once
CREATE UNIQUE INDEX ON public.eql_v2_configuration (state) WHERE state = 'active';

--! @brief Unique pending configuration constraint
--! @note Only one configuration can be 'pending' at once
CREATE UNIQUE INDEX ON public.eql_v2_configuration (state) WHERE state = 'pending';

--! @brief Unique encrypting configuration constraint
--! @note Only one configuration can be 'encrypting' at once
CREATE UNIQUE INDEX ON public.eql_v2_configuration (state) WHERE state = 'encrypting';


--! @brief Add a search index configuration for an encrypted column
--!
--! Configures a searchable encryption index (unique, match, ore, or ste_vec) on an
--! encrypted column. Creates or updates the pending configuration, then migrates
--! and activates it unless migrating flag is set.
--!
--! @param table_name Text Name of the table containing the column
--! @param column_name Text Name of the column to configure
--! @param index_name Text Type of index ('unique', 'match', 'ore', 'ste_vec')
--! @param cast_as Text PostgreSQL type for decrypted values (default: 'text')
--! @param opts JSONB Index-specific options (default: '{}')
--! @param migrating Boolean Skip auto-migration if true (default: false)
--! @return JSONB Updated configuration object
--! @throws Exception if index already exists for this column
--! @throws Exception if cast_as is not a valid type
--!
--! @example
--! -- Add unique index for exact-match searches
--! SELECT eql_v2.add_search_config('users', 'email', 'unique');
--!
--! -- Add match index for LIKE searches with custom token length
--! SELECT eql_v2.add_search_config('posts', 'content', 'match', 'text',
--!   '{"token_filters": [{"kind": "downcase"}], "tokenizer": {"kind": "ngram", "token_length": 3}}'
--! );
--!
--! @see eql_v2.add_column
--! @see eql_v2.remove_search_config
CREATE FUNCTION eql_v2.add_search_config(table_name text, column_name text, index_name text, cast_as text DEFAULT 'text', opts jsonb DEFAULT '{}', migrating boolean DEFAULT false)
  RETURNS jsonb

AS $$
  DECLARE
    o jsonb;
    _config jsonb;
  BEGIN

    -- set the active config
    SELECT data INTO _config FROM public.eql_v2_configuration WHERE state = 'active' OR state = 'pending' ORDER BY state DESC;

    -- if index exists
    IF _config #> array['tables', table_name, column_name, 'indexes'] ?  index_name THEN
      RAISE EXCEPTION '% index exists for column: % %', index_name, table_name, column_name;
    END IF;

    IF NOT cast_as = ANY('{text, int, small_int, big_int, real, double, boolean, date, jsonb}') THEN
      RAISE EXCEPTION '% is not a valid cast type', cast_as;
    END IF;

    -- set default config
    SELECT eql_v2.config_default(_config) INTO _config;

    SELECT eql_v2.config_add_table(table_name, _config) INTO _config;

    SELECT eql_v2.config_add_column(table_name, column_name, _config) INTO _config;

    SELECT eql_v2.config_add_cast(table_name, column_name, cast_as, _config) INTO _config;

    -- set default options for index if opts empty
    IF index_name = 'match' AND opts = '{}' THEN
      SELECT eql_v2.config_match_default() INTO opts;
    END IF;

    SELECT eql_v2.config_add_index(table_name, column_name, index_name, opts, _config) INTO _config;

    --  create a new pending record if we don't have one
    INSERT INTO public.eql_v2_configuration (state, data) VALUES ('pending', _config)
    ON CONFLICT (state)
      WHERE state = 'pending'
    DO UPDATE
      SET data = _config;

    IF NOT migrating THEN
      PERFORM eql_v2.migrate_config();
      PERFORM eql_v2.activate_config();
    END IF;

    PERFORM eql_v2.add_encrypted_constraint(table_name, column_name);

    -- exeunt
    RETURN _config;
  END;
$$ LANGUAGE plpgsql;

--! @brief Remove a search index configuration from an encrypted column
--!
--! Removes a previously configured search index from an encrypted column.
--! Updates the pending configuration, then migrates and activates it
--! unless migrating flag is set.
--!
--! @param table_name Text Name of the table containing the column
--! @param column_name Text Name of the column
--! @param index_name Text Type of index to remove
--! @param migrating Boolean Skip auto-migration if true (default: false)
--! @return JSONB Updated configuration object
--! @throws Exception if no active or pending configuration exists
--! @throws Exception if table is not configured
--! @throws Exception if column is not configured
--!
--! @example
--! -- Remove match index from column
--! SELECT eql_v2.remove_search_config('posts', 'content', 'match');
--!
--! @see eql_v2.add_search_config
--! @see eql_v2.modify_search_config
CREATE FUNCTION eql_v2.remove_search_config(table_name text, column_name text, index_name text, migrating boolean DEFAULT false)
  RETURNS jsonb
AS $$
  DECLARE
    _config jsonb;
  BEGIN

    -- set the active config
    SELECT data INTO _config FROM public.eql_v2_configuration WHERE state = 'active' OR state = 'pending' ORDER BY state DESC;

    -- if no config
    IF _config IS NULL THEN
      RAISE EXCEPTION 'No active or pending configuration exists';
    END IF;

    -- if the table doesn't exist
    IF NOT _config #> array['tables'] ? table_name THEN
      RAISE EXCEPTION 'No configuration exists for table: %', table_name;
    END IF;

    -- if the index does not exist
    -- IF NOT _config->key ? index_name THEN
    IF NOT _config #> array['tables', table_name] ?  column_name THEN
      RAISE EXCEPTION 'No % index exists for column: % %', index_name, table_name, column_name;
    END IF;

    --  create a new pending record if we don't have one
    INSERT INTO public.eql_v2_configuration (state, data) VALUES ('pending', _config)
    ON CONFLICT (state)
      WHERE state = 'pending'
    DO NOTHING;

    -- remove the index
    SELECT _config #- array['tables', table_name, column_name, 'indexes', index_name] INTO _config;

    -- update the config and migrate (even if empty)
    UPDATE public.eql_v2_configuration SET data = _config WHERE state = 'pending';

    IF NOT migrating THEN
      PERFORM eql_v2.migrate_config();
      PERFORM eql_v2.activate_config();
    END IF;

    -- exeunt
    RETURN _config;
  END;
$$ LANGUAGE plpgsql;

--! @brief Modify a search index configuration for an encrypted column
--!
--! Updates an existing search index configuration by removing and re-adding it
--! with new options. Convenience function that combines remove and add operations.
--! If index does not exist, it is added.
--!
--! @param table_name Text Name of the table containing the column
--! @param column_name Text Name of the column
--! @param index_name Text Type of index to modify
--! @param cast_as Text PostgreSQL type for decrypted values (default: 'text')
--! @param opts JSONB New index-specific options (default: '{}')
--! @param migrating Boolean Skip auto-migration if true (default: false)
--! @return JSONB Updated configuration object
--!
--! @example
--! -- Change match index tokenizer settings
--! SELECT eql_v2.modify_search_config('posts', 'content', 'match', 'text',
--!   '{"tokenizer": {"kind": "ngram", "token_length": 4}}'
--! );
--!
--! @see eql_v2.add_search_config
--! @see eql_v2.remove_search_config
CREATE FUNCTION eql_v2.modify_search_config(table_name text, column_name text, index_name text, cast_as text DEFAULT 'text', opts jsonb DEFAULT '{}', migrating boolean DEFAULT false)
  RETURNS jsonb
AS $$
  BEGIN
    PERFORM eql_v2.remove_search_config(table_name, column_name, index_name, migrating);
    RETURN eql_v2.add_search_config(table_name, column_name, index_name, cast_as, opts, migrating);
  END;
$$ LANGUAGE plpgsql;

--! @brief Migrate pending configuration to encrypting state
--!
--! Transitions the pending configuration to encrypting state, validating that
--! all configured columns have encrypted target columns ready. This is part of
--! the configuration lifecycle: pending → encrypting → active.
--!
--! @return Boolean True if migration succeeds
--! @throws Exception if encryption already in progress
--! @throws Exception if no pending configuration exists
--! @throws Exception if configured columns lack encrypted targets
--!
--! @example
--! -- Manually migrate configuration (normally done automatically)
--! SELECT eql_v2.migrate_config();
--!
--! @see eql_v2.activate_config
--! @see eql_v2.add_column
CREATE FUNCTION eql_v2.migrate_config()
  RETURNS boolean
AS $$
	BEGIN

    IF EXISTS (SELECT FROM public.eql_v2_configuration c WHERE c.state = 'encrypting') THEN
      RAISE EXCEPTION 'An encryption is already in progress';
    END IF;

		IF NOT EXISTS (SELECT FROM public.eql_v2_configuration c WHERE c.state = 'pending') THEN
			RAISE EXCEPTION 'No pending configuration exists to encrypt';
		END IF;

    IF NOT eql_v2.ready_for_encryption() THEN
      RAISE EXCEPTION 'Some pending columns do not have an encrypted target';
    END IF;

    UPDATE public.eql_v2_configuration SET state = 'encrypting' WHERE state = 'pending';
		RETURN true;
  END;
$$ LANGUAGE plpgsql;

--! @brief Activate encrypting configuration
--!
--! Transitions the encrypting configuration to active state, making it the
--! current operational configuration. Marks previous active configuration as
--! inactive. Final step in configuration lifecycle: pending → encrypting → active.
--!
--! @return Boolean True if activation succeeds
--! @throws Exception if no encrypting configuration exists to activate
--!
--! @example
--! -- Manually activate configuration (normally done automatically)
--! SELECT eql_v2.activate_config();
--!
--! @see eql_v2.migrate_config
--! @see eql_v2.add_column
CREATE FUNCTION eql_v2.activate_config()
  RETURNS boolean
AS $$
	BEGIN

	  IF EXISTS (SELECT FROM public.eql_v2_configuration c WHERE c.state = 'encrypting') THEN
	  	UPDATE public.eql_v2_configuration SET state = 'inactive' WHERE state = 'active';
			UPDATE public.eql_v2_configuration SET state = 'active' WHERE state = 'encrypting';
			RETURN true;
		ELSE
			RAISE EXCEPTION 'No encrypting configuration exists to activate';
		END IF;
  END;
$$ LANGUAGE plpgsql;

--! @brief Discard pending configuration
--!
--! Deletes the pending configuration without applying changes. Use this to
--! abandon configuration changes before they are migrated and activated.
--!
--! @return Boolean True if discard succeeds
--! @throws Exception if no pending configuration exists to discard
--!
--! @example
--! -- Discard uncommitted configuration changes
--! SELECT eql_v2.discard();
--!
--! @see eql_v2.add_column
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2.discard()
  RETURNS boolean
AS $$
  BEGIN
    IF EXISTS (SELECT FROM public.eql_v2_configuration c WHERE c.state = 'pending') THEN
        DELETE FROM public.eql_v2_configuration WHERE state = 'pending';
      RETURN true;
    ELSE
      RAISE EXCEPTION 'No pending configuration exists to discard';
    END IF;
  END;
$$ LANGUAGE plpgsql;

--! @brief Configure a column for encryption
--!
--! Adds a column to the encryption configuration, making it eligible for
--! encrypted storage and search indexes. Creates or updates pending configuration,
--! adds encrypted constraint, then migrates and activates unless migrating flag is set.
--!
--! @param table_name Text Name of the table containing the column
--! @param column_name Text Name of the column to encrypt
--! @param cast_as Text PostgreSQL type to cast decrypted values (default: 'text')
--! @param migrating Boolean Skip auto-migration if true (default: false)
--! @return JSONB Updated configuration object
--! @throws Exception if column already configured for encryption
--!
--! @example
--! -- Configure email column for encryption
--! SELECT eql_v2.add_column('users', 'email', 'text');
--!
--! -- Configure age column with integer casting
--! SELECT eql_v2.add_column('users', 'age', 'int');
--!
--! @see eql_v2.add_search_config
--! @see eql_v2.remove_column
CREATE FUNCTION eql_v2.add_column(table_name text, column_name text, cast_as text DEFAULT 'text', migrating boolean DEFAULT false)
  RETURNS jsonb
AS $$
  DECLARE
    key text;
    _config jsonb;
  BEGIN
    -- set the active config
    SELECT data INTO _config FROM public.eql_v2_configuration WHERE state = 'active' OR state = 'pending' ORDER BY state DESC;

    -- set default config
    SELECT eql_v2.config_default(_config) INTO _config;

    -- if index exists
    IF _config #> array['tables', table_name] ?  column_name THEN
      RAISE EXCEPTION 'Config exists for column: % %', table_name, column_name;
    END IF;

    SELECT eql_v2.config_add_table(table_name, _config) INTO _config;

    SELECT eql_v2.config_add_column(table_name, column_name, _config) INTO _config;

    SELECT eql_v2.config_add_cast(table_name, column_name, cast_as, _config) INTO _config;

    --  create a new pending record if we don't have one
    INSERT INTO public.eql_v2_configuration (state, data) VALUES ('pending', _config)
    ON CONFLICT (state)
      WHERE state = 'pending'
    DO UPDATE
      SET data = _config;

    IF NOT migrating THEN
      PERFORM eql_v2.migrate_config();
      PERFORM eql_v2.activate_config();
    END IF;

    PERFORM eql_v2.add_encrypted_constraint(table_name, column_name);

    -- exeunt
    RETURN _config;
  END;
$$ LANGUAGE plpgsql;

--! @brief Remove a column from encryption configuration
--!
--! Removes a column from the encryption configuration, including all associated
--! search indexes. Removes encrypted constraint, updates pending configuration,
--! then migrates and activates unless migrating flag is set.
--!
--! @param table_name Text Name of the table containing the column
--! @param column_name Text Name of the column to remove
--! @param migrating Boolean Skip auto-migration if true (default: false)
--! @return JSONB Updated configuration object
--! @throws Exception if no active or pending configuration exists
--! @throws Exception if table is not configured
--! @throws Exception if column is not configured
--!
--! @example
--! -- Remove email column from encryption
--! SELECT eql_v2.remove_column('users', 'email');
--!
--! @see eql_v2.add_column
--! @see eql_v2.remove_search_config
CREATE FUNCTION eql_v2.remove_column(table_name text, column_name text, migrating boolean DEFAULT false)
  RETURNS jsonb
AS $$
  DECLARE
    key text;
    _config jsonb;
  BEGIN
     -- set the active config
    SELECT data INTO _config FROM public.eql_v2_configuration WHERE state = 'active' OR state = 'pending' ORDER BY state DESC;

    -- if no config
    IF _config IS NULL THEN
      RAISE EXCEPTION 'No active or pending configuration exists';
    END IF;

    -- if the table doesn't exist
    IF NOT _config #> array['tables'] ? table_name THEN
      RAISE EXCEPTION 'No configuration exists for table: %', table_name;
    END IF;

    -- if the column does not exist
    IF NOT _config #> array['tables', table_name] ?  column_name THEN
      RAISE EXCEPTION 'No configuration exists for column: % %', table_name, column_name;
    END IF;

    --  create a new pending record if we don't have one
    INSERT INTO public.eql_v2_configuration (state, data) VALUES ('pending', _config)
    ON CONFLICT (state)
      WHERE state = 'pending'
    DO NOTHING;

    -- remove the column
    SELECT _config #- array['tables', table_name, column_name] INTO _config;

    -- if table  is now empty, remove the table
    IF _config #> array['tables', table_name] = '{}' THEN
      SELECT _config #- array['tables', table_name] INTO _config;
    END IF;

    PERFORM eql_v2.remove_encrypted_constraint(table_name, column_name);

    -- update the config (even if empty) and activate
    UPDATE public.eql_v2_configuration SET data = _config WHERE state = 'pending';

    IF NOT migrating THEN
      -- For empty configs, skip migration validation and directly activate
      IF _config #> array['tables'] = '{}' THEN
        UPDATE public.eql_v2_configuration SET state = 'inactive' WHERE state = 'active';
        UPDATE public.eql_v2_configuration SET state = 'active' WHERE state = 'pending';
      ELSE
        PERFORM eql_v2.migrate_config();
        PERFORM eql_v2.activate_config();
      END IF;
    END IF;

    -- exeunt
    RETURN _config;

  END;
$$ LANGUAGE plpgsql;

--! @brief Reload configuration from CipherStash Proxy
--!
--! Placeholder function for reloading configuration from the CipherStash Proxy.
--! Currently returns NULL without side effects.
--!
--! @return Void
--!
--! @note This function may be used for configuration synchronization in future versions
CREATE FUNCTION eql_v2.reload_config()
  RETURNS void
LANGUAGE sql STRICT PARALLEL SAFE
BEGIN ATOMIC
  RETURN NULL;
END;

--! @brief Query encryption configuration in tabular format
--!
--! Returns the active encryption configuration as a table for easier querying
--! and filtering. Shows all configured tables, columns, cast types, and indexes.
--!
--! @return TABLE Contains configuration state, relation name, column name, cast type, and indexes
--!
--! @example
--! -- View all encrypted columns
--! SELECT * FROM eql_v2.config();
--!
--! -- Find all columns with match indexes
--! SELECT relation, col_name FROM eql_v2.config()
--! WHERE indexes ? 'match';
--!
--! @see eql_v2.add_column
--! @see eql_v2.add_search_config
CREATE FUNCTION eql_v2.config() RETURNS TABLE (
    state eql_v2_configuration_state,
    relation text,
    col_name text,
    decrypts_as text,
    indexes jsonb
)
AS $$
BEGIN
    RETURN QUERY
      WITH tables AS (
          SELECT config.state, tables.key AS table, tables.value AS config
          FROM public.eql_v2_configuration config, jsonb_each(data->'tables') tables
          WHERE config.data->>'v' = '1'
      )
      SELECT
          tables.state,
          tables.table,
          column_config.key,
          column_config.value->>'cast_as',
          column_config.value->'indexes'
      FROM tables, jsonb_each(tables.config) column_config;
END;
$$ LANGUAGE plpgsql;

--! @file config/constraints.sql
--! @brief Configuration validation functions and constraints
--!
--! Provides CHECK constraint functions to validate encryption configuration structure.
--! Ensures configurations have required fields (version, tables) and valid values
--! for index types and cast types before being stored.
--!
--! @see config/tables.sql where constraints are applied


--! @brief Extract index type names from configuration
--! @internal
--!
--! Helper function that extracts all index type names from the configuration's
--! 'indexes' sections across all tables and columns.
--!
--! @param jsonb Configuration data to extract from
--! @return SETOF text Index type names (e.g., 'match', 'ore', 'unique', 'ste_vec')
--!
--! @note Used by config_check_indexes for validation
--! @see eql_v2.config_check_indexes
CREATE FUNCTION eql_v2.config_get_indexes(val jsonb)
    RETURNS SETOF text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
BEGIN ATOMIC
	SELECT jsonb_object_keys(jsonb_path_query(val,'$.tables.*.*.indexes'));
END;


--! @brief Validate index types in configuration
--! @internal
--!
--! Checks that all index types specified in the configuration are valid.
--! Valid index types are: match, ore, unique, ste_vec.
--!
--! @param jsonb Configuration data to validate
--! @return boolean True if all index types are valid
--! @throws Exception if any invalid index type found
--!
--! @note Used in CHECK constraint on eql_v2_configuration table
--! @see eql_v2.config_get_indexes
CREATE FUNCTION eql_v2.config_check_indexes(val jsonb)
  RETURNS BOOLEAN
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
	BEGIN

    IF (SELECT EXISTS (SELECT eql_v2.config_get_indexes(val))) THEN
      IF (SELECT bool_and(index = ANY('{match, ore, unique, ste_vec}')) FROM eql_v2.config_get_indexes(val) AS index) THEN
        RETURN true;
      END IF;
      RAISE 'Configuration has an invalid index (%). Index should be one of {match, ore, unique, ste_vec}', val;
    END IF;
    RETURN true;
  END;
$$ LANGUAGE plpgsql;


--! @brief Validate cast types in configuration
--! @internal
--!
--! Checks that all 'cast_as' types specified in the configuration are valid.
--! Valid cast types are: text, int, small_int, big_int, real, double, boolean, date, jsonb.
--!
--! @param jsonb Configuration data to validate
--! @return boolean True if all cast types are valid or no cast types specified
--! @throws Exception if any invalid cast type found
--!
--! @note Used in CHECK constraint on eql_v2_configuration table
--! @note Empty configurations (no cast_as fields) are valid
--! @note Cast type names are EQL's internal representations, not PostgreSQL native types
CREATE FUNCTION eql_v2.config_check_cast(val jsonb)
  RETURNS BOOLEAN
AS $$
	BEGIN
    -- If there are cast_as fields, validate them
    IF EXISTS (SELECT jsonb_array_elements_text(jsonb_path_query_array(val, '$.tables.*.*.cast_as'))) THEN
      IF (SELECT bool_and(cast_as = ANY('{text, int, small_int, big_int, real, double, boolean, date, jsonb}')) 
          FROM (SELECT jsonb_array_elements_text(jsonb_path_query_array(val, '$.tables.*.*.cast_as')) AS cast_as) casts) THEN
        RETURN true;
      END IF;
      RAISE 'Configuration has an invalid cast_as (%). Cast should be one of {text, int, small_int, big_int, real, double, boolean, date, jsonb}', val;
    END IF;
    -- If no cast_as fields exist (empty config), that's valid
    RETURN true;
  END;
$$ LANGUAGE plpgsql;


--! @brief Validate tables field presence
--! @internal
--!
--! Ensures the configuration has a 'tables' field, which is required
--! to specify which database tables contain encrypted columns.
--!
--! @param jsonb Configuration data to validate
--! @return boolean True if 'tables' field exists
--! @throws Exception if 'tables' field is missing
--!
--! @note Used in CHECK constraint on eql_v2_configuration table
CREATE FUNCTION eql_v2.config_check_tables(val jsonb)
  RETURNS boolean
AS $$
	BEGIN
    IF (val ? 'tables') THEN
      RETURN true;
    END IF;
    RAISE 'Configuration missing tables (tables) field: %', val;
  END;
$$ LANGUAGE plpgsql;


--! @brief Validate version field presence
--! @internal
--!
--! Ensures the configuration has a 'v' (version) field, which tracks
--! the configuration format version.
--!
--! @param jsonb Configuration data to validate
--! @return boolean True if 'v' field exists
--! @throws Exception if 'v' field is missing
--!
--! @note Used in CHECK constraint on eql_v2_configuration table
CREATE FUNCTION eql_v2.config_check_version(val jsonb)
  RETURNS boolean
AS $$
	BEGIN
    IF (val ? 'v') THEN
      RETURN true;
    END IF;
    RAISE 'Configuration missing version (v) field: %', val;
  END;
$$ LANGUAGE plpgsql;


--! @brief Drop existing data validation constraint if present
--! @note Allows constraint to be recreated during upgrades
ALTER TABLE public.eql_v2_configuration DROP CONSTRAINT IF EXISTS eql_v2_configuration_data_check;


--! @brief Comprehensive configuration data validation
--!
--! CHECK constraint that validates all aspects of configuration data:
--! - Version field presence
--! - Tables field presence
--! - Valid cast_as types
--! - Valid index types
--!
--! @note Combines all config_check_* validation functions
--! @see eql_v2.config_check_version
--! @see eql_v2.config_check_tables
--! @see eql_v2.config_check_cast
--! @see eql_v2.config_check_indexes
ALTER TABLE public.eql_v2_configuration
  ADD CONSTRAINT eql_v2_configuration_data_check CHECK (
    eql_v2.config_check_version(data) AND
    eql_v2.config_check_tables(data) AND
    eql_v2.config_check_cast(data) AND
    eql_v2.config_check_indexes(data)
);




--! @brief Compare two encrypted values using Blake3 hash index terms
--!
--! Performs a three-way comparison (returns -1/0/1) of encrypted values using
--! their Blake3 hash index terms. Used internally by the equality operator (=)
--! for exact-match queries without decryption.
--!
--! @param a eql_v2_encrypted First encrypted value to compare
--! @param b eql_v2_encrypted Second encrypted value to compare
--! @return Integer -1 if a < b, 0 if a = b, 1 if a > b
--!
--! @note NULL values are sorted before non-NULL values
--! @note Comparison uses underlying text type ordering of Blake3 hashes
--!
--! @see eql_v2.blake3
--! @see eql_v2.has_blake3
--! @see eql_v2."="
CREATE FUNCTION eql_v2.compare_blake3(a eql_v2_encrypted, b eql_v2_encrypted)
  RETURNS integer
  IMMUTABLE STRICT PARALLEL SAFE
AS $$
  DECLARE
    a_term eql_v2.blake3;
    b_term eql_v2.blake3;
  BEGIN

    IF a IS NULL AND b IS NULL THEN
      RETURN 0;
    END IF;

    IF a IS NULL THEN
      RETURN -1;
    END IF;

    IF b IS NULL THEN
      RETURN 1;
    END IF;

    IF eql_v2.has_blake3(a) THEN
      a_term = eql_v2.blake3(a);
    END IF;

    IF eql_v2.has_blake3(b) THEN
      b_term = eql_v2.blake3(b);
    END IF;

    IF a_term IS NULL AND b_term IS NULL THEN
      RETURN 0;
    END IF;

    IF a_term IS NULL THEN
      RETURN -1;
    END IF;

    IF b_term IS NULL THEN
      RETURN 1;
    END IF;

    -- Using the underlying text type comparison
    IF a_term = b_term THEN
      RETURN 0;
    END IF;

    IF a_term < b_term THEN
      RETURN -1;
    END IF;

    IF a_term > b_term THEN
      RETURN 1;
    END IF;

  END;
$$ LANGUAGE plpgsql;
`;
