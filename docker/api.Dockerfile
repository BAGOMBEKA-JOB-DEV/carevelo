# The Laravel API, the queue worker and the scheduler all run from this image.
#
# ONE IMAGE, THREE PROCESSES, and that is deliberate. They share a codebase and a
# configuration; splitting them into three images would mean three things to keep
# in step and three chances for a worker to run last week's code against this
# week's schema. The compose file runs the same image with different commands.
FROM php:8.3-cli-alpine

# intl for the Africa/Kampala date handling, pdo_pgsql for the database, zip and
# gd for the prescription PDF, pcntl for the queue worker's signal handling --
# without it `queue:work` cannot shut down gracefully and a deploy kills a job
# mid-flight.
RUN apk add --no-cache postgresql-dev icu-dev libzip-dev oniguruma-dev freetype-dev \
      libjpeg-turbo-dev libpng-dev git unzip \
 && docker-php-ext-configure gd --with-freetype --with-jpeg \
 && docker-php-ext-install -j"$(nproc)" pdo_pgsql intl zip bcmath gd pcntl opcache \
 && apk del postgresql-dev icu-dev libzip-dev

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

# DEPENDENCIES BEFORE SOURCE, so a code change does not reinstall the world.
# --no-scripts because artisan is not here yet; scripts run after the copy below.
COPY backend/composer.json backend/composer.lock ./
RUN composer install --no-interaction --no-scripts --prefer-dist

COPY backend/ ./
RUN composer dump-autoload --optimize

EXPOSE 8000
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
