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

#![deny(clippy::unwrap_used)]
#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod error;
pub mod integrity;
pub mod migrate;
pub mod schema;

pub use error::{DbError, DbResult};
pub use migrate::{adopt, schema_version, table_exists, AdoptionReport, LATEST_VERSION};
