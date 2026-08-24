/**
 * Run before every test file, in both projects.
 *
 * ONE JOB: pin the clock's zone to Africa/Kampala.
 *
 * Every timestamp this product shows a human is shown in Kampala time — that is where
 * the patients, the clinics and the riders are, and an appointment rendered in the
 * server's zone is an appointment somebody misses. A test that formats a time and
 * asserts on the result would therefore pass on a laptop set to EAT and fail in CI on
 * UTC, or the reverse: three hours of difference is enough to move a date, so the
 * failure would not even look like a timezone bug. It would look like the wrong day.
 *
 * Setting it here rather than in each test file means a test cannot forget, and setting
 * it rather than mocking Date means the code under test keeps using the real one.
 *
 * Node re-reads TZ on the next date operation, so an assignment at setup time is enough;
 * this does not need to happen before the process starts. Only forced when nothing else
 * has an opinion, so `TZ=UTC pnpm test` still does what whoever typed it meant.
 */
process.env.TZ ??= 'Africa/Kampala'
