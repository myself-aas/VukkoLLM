//! Storage engine: schema, migrations, legacy Room adoption and integrity.
//!
//! The crate owns every SQL statement in the project. Nothing above it (core,
//! services, bridge) is allowed to see a table name or issue a query; they call
//! domain methods and receive domain values.
//!
//! Public surface:
//! - [`migrate`] — versioned, forward-only migrations and legacy adoption;
//! - [`integrity`] — health checks the storage inspector shows the user;
//! - [`schema`] — the column contract, used by validation and tests.

// Pedantic is advisory: it is here so the suggestions show up in review, not so
// they fail a build. The gate runs `-D warnings`; without this `allow` the two
// attributes contradict each other and doc-backtick style becomes a hard error.
#![allow(clippy::pedantic)]
// `unwrap_used` is denied on purpose — but a test asserting on a known-good
// fixture is exactly where panicking is the intended behaviour, so the denial
// is scoped to production code instead of being weakened for the whole crate.
#![cfg_attr(not(test), deny(clippy::unwrap_used))]
#![allow(clippy::module_name_repetitions)]

pub mod error;
pub mod integrity;
pub mod migrate;
pub mod schema;

pub use error::{DbError, DbResult};
pub use migrate::{adopt, schema_version, table_exists, AdoptionReport, LATEST_VERSION};
