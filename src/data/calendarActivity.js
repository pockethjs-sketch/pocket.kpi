// Unlinked schedules remain display-only; never create/save a lead for them.
export function calendarActivityLeads(calendar, leads) {
  return (calendar || []).map(meeting => {
    const matches = (leads || []).filter(lead =>
      (meeting.clientNo != null && lead.id === 'crm-' + meeting.clientNo)
      || (meeting.projNo != null && String(lead.projNo ?? '') === String(meeting.projNo)));
    const linked = matches.length === 1 ? matches[0] : null;
    return { ...(linked || {}), id: linked?.id || '', company: linked?.company || meeting.company,
      salesOwner: linked?.salesOwner || meeting.owner, ctype: linked?.ctype || '미분류',
      crmMeetings: [meeting], crmMeeting: null };
  });
}
