import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/sanitize'
import { withSignedAvatar } from '@/lib/avatar-url'


export async function PUT(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error } = await supabase.auth.getUser()

        if (error || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const {
            npiNumber,
            deaNumber,
            deaExpirationDate,
        } = body

        const updatedProfile = await prisma.userProfile.update({
            where: { supabaseId: user.id },
            data: {
                ...(npiNumber !== undefined && {
                    npiNumber: npiNumber ? sanitizeText(npiNumber, 10) : null,
                }),
                ...(deaNumber !== undefined && {
                    deaNumber: deaNumber ? sanitizeText(deaNumber, 20) : null,
                }),
                ...(deaExpirationDate !== undefined && {
                    deaExpirationDate: deaExpirationDate ? new Date(deaExpirationDate) : null,
                }),
            },
        })

        // The settings page takes this row as the profile, its photo included,
        // so the photo goes out as a link that expires (lib/avatar-url.ts).
        return NextResponse.json(await withSignedAvatar(updatedProfile))
    } catch (err) {
        console.error('Federal registrations update error:', err)
        return NextResponse.json(
            { error: 'Failed to update federal registrations' },
            { status: 500 }
        )
    }
}
