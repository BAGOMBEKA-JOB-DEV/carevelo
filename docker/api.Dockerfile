# syntax=docker/dockerfile:1
#
# The Laravel API, the queue worker, the scheduler, Reverb and the one-shot
# setup job all run from this image. All five services pin
# `image: carevelo-api:dev` so Compose builds it once rather than five times.
#
# ONE IMAGE, FIVE PROCESSES, deliberately. They share a codebase and a
# configuration; splitting them would mean five things to keep in step and five
# chances for a worker to run last week's code against this week's schema.
#
# ============================================================================
# IT INSTALLS NO PHP PACKAGES. It runs against the host's `backend/vendor`,
# mounted by compose -- see docker/web.Dockerfile for the full reasoning. Short
# version: an earlier build fetched everything over a 9-42 KiB/s link and never
# finished, and the host already has it all.
#
# `php:8.3-cli` rather than `-alpine` so the runtime is glibc and matches the
# host, the same reason the web image is `node:22` rather than `node:22-alpine`.
#
# THE EXTENSIONS ARE STILL COMPILED IN, and must be: they are PHP runtime
# extensions, not Composer packages, so they are not in vendor/ and no mount can
# supply them. That is one `docker-php-ext-install`, not 377 tarballs.
# ============================================================================
FROM php:8.3-cli

# intl for the Africa/Kampala date handling, pdo_pgsql for the database, zip and
# gd for the prescription PDF, pcntl for the queue worker's signal handling --
# without it `queue:work` cannot shut down gracefully and a deploy kills a job
# mid-flight.
#
# REDIS COMES FROM PECL, NOT FROM docker-php-ext-install, because it is not
# bundled with PHP. Leaving it out is a late and confusing failure rather than an
# obvious one: the container boots, migrations start, and the FIFTH migration
# dies with `Class "Redis" not found` -- because that is the first line to touch
# the cache. docker/api.env drives cache, queue and session through Redis, so
# nothing here works without it.
#
# `printf '\n' | pecl install` answers the one prompt it asks (igbinary/lzf
# support) with the default; an unanswered prompt hangs the build forever.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpq-dev libicu-dev libzip-dev libonig-dev libfreetype6-dev \
      libjpeg62-turbo-dev libpng-dev unzip \
 && docker-php-ext-configure gd --with-freetype --with-jpeg \
 && docker-php-ext-install -j"$(nproc)" pdo_pgsql intl zip bcmath gd pcntl opcache \
 && printf '\n' | pecl install redis \
 && docker-php-ext-enable redis \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

EXPOSE 8000
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
