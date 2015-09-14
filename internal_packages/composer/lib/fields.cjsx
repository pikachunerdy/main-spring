Fields =
  To: "textFieldTo"
  Cc: "textFieldCc"
  Bcc: "textFieldBcc"
  From: "fromField"
  Subject: "textFieldSubject"
  Body: "contentBody"
Fields.ParticipantFields = [Fields.To, Fields.Cc, Fields.Bcc, Fields.From]

Fields.Order =
  "textFieldTo": 1
  "textFieldCc": 2
  "textFieldBcc": 3
  "fromField": -1 # Not selectable
  "textFieldSubject": 5
  "contentBody": 6
module.exports = Fields
