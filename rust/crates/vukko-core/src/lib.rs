//! Vukko core: domain model, persistence, providers, exports and backup logic.
//!
//! Layering: `domain` is pure data, `repository` owns SQLite access,
//! `services` composes repositories into use cases, `providers` speaks to model
//! backends. The bridge crate (`vukko-bridge`) is the only place that knows
//! about FFI, and it exposes domain operations only.

#![deny(clippy::unwrap_used)]
#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod domain;
pub mod providers;
pub mod repository;
pub mod services;

pub use domain::Timestamp;
