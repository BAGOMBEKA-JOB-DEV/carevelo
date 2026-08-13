<?php

namespace App\Support\Notifications;

/**
 * The prohibited-content list, and the guard that applies it.
 *
 * ONE list, used twice on purpose: the template review test asserts the whole
 * catalogue against it, and the renderer applies it to every interpolated value
 * at runtime. A test alone would only prove the patterns are clean, and a
 * pattern is clean right up until a caller interpolates a medicine name into
 * `{reference}`.
 *
 * The list is blunt and will occasionally refuse something harmless. That is
 * the correct trade: a false refusal is a support ticket, and a false pass is a
 * notifiable disclosure of special-category data under DPPA 2019.
 *
 * WHAT IS DELIBERATELY NOT CHECKED: the clinic's own name. A clinic may
 * legitimately trade as something clinical, its name is on the alphanumeric
 * sender ID whatever we do (§F), and refusing to send that tenant's messages
 * would break its entire notification flow while disclosing nothing new.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 */
final class ProhibitedContent
{
    /**
     * Terms that must never appear in a message body.
     *
     * Not exhaustive and cannot be — it is a tripwire, not a filter. The
     * control is the design rule that templates state only that something is
     * ready; this catches the moment someone forgets it.
     *
     * @return list<string>
     */
    public static function terms(): array
    {
        return [
            // Diagnoses and findings.
            'diagnos', 'test result', 'lab result', 'results are', 'positive', 'negative',
            'malaria', 'hiv', 'tuberculosis', 'typhoid', 'cholera', 'diabet', 'hypertens',
            'cancer', 'sickle', 'infection', 'symptom', 'disease', 'pregnan', 'antenatal',

            // Medicines. Anything nameable on a prescription in this market.
            'amoxicillin', 'paracetamol', 'artemether', 'lumefantrine', 'coartem',
            'metformin', 'ibuprofen', 'ciprofloxacin', 'azithromycin', 'omeprazole',
            'insulin', 'morphine', 'diazepam', 'codeine', 'tramadol', 'prednisolone',
            'antiretroviral', 'panadol', 'septrin',

            // The shape of clinical content, even where the term itself is not
            // a diagnosis: dosage lines and reasons for attendance.
            'dosage', 'tablet', 'capsule', 'syrup', 'injection', 'medicine', 'medication',
            'clinical note', 'reason for', 'treatment for',
        ];
    }

    /**
     * The first prohibited term in the text, or null if it is clean.
     *
     * Returned rather than thrown so the template review test can report every
     * violation at once instead of one per run.
     */
    public static function firstMatch(string $text): ?string
    {
        $haystack = mb_strtolower($text);

        foreach (self::terms() as $term) {
            if (str_contains($haystack, $term)) {
                return $term;
            }
        }

        return null;
    }

    public static function isClean(string $text): bool
    {
        return self::firstMatch($text) === null;
    }

    /**
     * @param  string  $context  where the text came from, e.g. "parameter [reference]"
     *
     * @throws ProhibitedNotificationContent
     */
    public static function assertClean(string $text, string $context): void
    {
        if (! self::isClean($text)) {
            throw ProhibitedNotificationContent::in($context);
        }
    }
}
