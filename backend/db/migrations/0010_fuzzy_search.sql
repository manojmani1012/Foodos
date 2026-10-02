-- Typo-tolerant search.
--
-- Indian dish names have several accepted spellings — biryani and briyani,
-- paneer and panner — and a customer who types one must still find the other.
-- Exact substring matching cannot do that, so trigram similarity is used:
-- "briyani" and "biryani" share most of their three-letter sequences, which
-- scores them as a near match.

create extension if not exists pg_trgm;

-- GIN trigram indexes make both ILIKE '%...%' and similarity() fast. Without
-- these, every search is a full scan.
create index restaurants_name_trgm_idx on restaurants using gin (name gin_trgm_ops);
create index menu_items_name_trgm_idx on menu_items using gin (name gin_trgm_ops);

-- Cuisines are a text[], and array_to_string is only STABLE, so it cannot go in
-- an index expression. Cuisine matching therefore runs unindexed over the
-- unnested array. That is fine at this size; if the restaurant table grows past
-- a few thousand rows, move cuisines to their own table and index that.
