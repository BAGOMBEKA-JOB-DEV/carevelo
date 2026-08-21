<?php

namespace App\Support\Auth;

/**
 * The password clinic staff read aloud when they create a patient's account.
 *
 * THE SERVER CHOOSES IT, never the person at the desk. A front desk creating
 * twenty accounts a day types `kira2026` twenty times, and then every account at
 * that clinic is guessable by anyone who was ever given one. That is not a
 * hypothetical failure of discipline; it is what a human being does with a field
 * they have to fill in two hundred times a month.
 *
 * IT IS READ ACROSS A DESK, OUT LOUD, and frequently written on a slip of paper
 * by someone whose first language is not English. So it is words, not entropy in
 * base64: a passphrase survives being spoken, repeated back, and typed on a
 * phone keyboard, and `Xk3!vQ` does not. Every word below is short, common,
 * spelled the way it sounds, and unambiguous when heard -- no homophones
 * ('flour'/'flower'), no pairs that differ by one letter, and nothing that reads
 * as clinical, which this must never do: the account belongs to a patient and
 * the password is spoken in a waiting room.
 *
 * The digits are separated by a hyphen so that "seven four one two" is not heard
 * as part of the last word, and the alphabet is deliberately lower case
 * throughout -- a capital letter is a thing to get wrong, and it buys no entropy
 * worth the support call.
 *
 * Strength: four words from a 128-word list plus four digits is 4 * 7 + 13.2 ~=
 * 41 bits, drawn from the CSPRNG. That is not a passphrase to hold for a year,
 * and it is not asked to be: it is discharged on first sign-in by
 * RequirePasswordChange, sign-in is throttled by AuthThrottle, and the whole
 * window it has to survive is the walk from the registration desk to the
 * patient's own phone.
 *
 * It is never stored in the clear, never audited, never logged, and NEVER SENT
 * BY SMS. A message reading "your password is ..." is the exact shape the
 * deleted one-time-code template forbade in its own docblock, and an SMS sits in
 * a notification row, a gateway's outbox and a handset's lock screen.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
class InitialPassword
{
    /** How many words are drawn. */
    private const WORDS = 4;

    /**
     * Words that survive being spoken across a desk.
     *
     * 128 of them, so each draw is exactly seven bits and the arithmetic above is
     * honest rather than approximate. Adding or removing one changes the strength
     * of every password this class has ever issued, so the count is asserted by
     * the test suite.
     *
     * @var list<string>
     */
    private const WORDLIST = [
        'anchor', 'apple', 'arrow', 'basket', 'bridge', 'bucket', 'button', 'cabin',
        'camel', 'candle', 'canvas', 'carpet', 'castle', 'cedar', 'chapel', 'cherry',
        'cliff', 'cloud', 'clover', 'coffee', 'compass', 'copper', 'cotton', 'crayon',
        'crown', 'crystal', 'dolphin', 'donkey', 'dragon', 'drawer', 'drum', 'eagle',
        'ember', 'engine', 'fabric', 'falcon', 'feather', 'fence', 'ferry', 'fiddle',
        'forest', 'fountain', 'garden', 'ginger', 'giraffe', 'glacier', 'granite', 'guitar',
        'hammer', 'harbour', 'harvest', 'helmet', 'hollow', 'honey', 'island', 'jacket',
        'jungle', 'kettle', 'kitchen', 'ladder', 'lantern', 'lemon', 'leopard', 'lily',
        'lizard', 'lobby', 'magnet', 'mango', 'maple', 'marble', 'market', 'meadow',
        'mirror', 'monkey', 'mountain', 'muffin', 'nectar', 'needle', 'nutmeg', 'ocean',
        'orbit', 'orchard', 'ostrich', 'otter', 'oyster', 'palace', 'panther', 'parcel',
        'pebble', 'pelican', 'pepper', 'pigeon', 'pillow', 'planet', 'pocket', 'pumpkin',
        'pyramid', 'rabbit', 'radish', 'ribbon', 'river', 'rocket', 'saddle', 'saffron',
        'salmon', 'seagull', 'shelf', 'shovel', 'silver', 'sparrow', 'spinach', 'sponge',
        'squirrel', 'stadium', 'sugar', 'sunset', 'table', 'teapot', 'temple', 'thunder',
        'tiger', 'tomato', 'trolley', 'trumpet', 'turtle', 'valley', 'velvet', 'window',
    ];

    /**
     * A fresh passphrase, for one account, spoken once.
     *
     * random_int and not rand() or Str::random()'s alphabet: this is a credential
     * that opens a medical record, and a predictable one is no credential at all.
     */
    public function generate(): string
    {
        $words = [];

        for ($drawn = 0; $drawn < self::WORDS; $drawn++) {
            $words[] = self::WORDLIST[random_int(0, count(self::WORDLIST) - 1)];
        }

        // Four digits, hyphen-separated from the words so that a person reading
        // the phrase aloud does not run them into the final word.
        return implode('-', $words).'-'.str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
    }

    /**
     * The size of the word list, so the strength claim above can be tested.
     */
    public static function wordCount(): int
    {
        return count(self::WORDLIST);
    }
}
