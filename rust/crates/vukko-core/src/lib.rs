//! Vukko core: domain model, persistence, providers, exports and backup logic.
//!
//! Layering: `domain` is pure data, `repository` owns SQLite access,
//! `services` composes repositories into use cases, `providers` speaks to model
//! backends. The bridge crate (`vukko-bridge`) is the only place that knows
//! about FFI, and it exposes domain operations only.

// Pedantic is advisory: it is here so the suggestions show up in review, not so
// they fail a build. The gate runs `-D warnings`; without this `allow` the two
// attributes contradict each other and doc-backtick style becomes a hard error.
#![allow(clippy::pedantic)]
// `unwrap_used` is denied on purpose — but a test asserting on a known-good
// fixture is exactly where panicking is the intended behaviour, so the denial
// is scoped to production code instead of being weakened for the whole crate.
#![cfg_attr(not(test), deny(clippy::unwrap_used))]
#![allow(clippy::module_name_repetitions)]

pub mod domain;
pub mod providers;
pub mod repository;
pub mod services;

pub use domain::Timestamp;
